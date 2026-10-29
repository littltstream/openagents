"""Configure this Workspace's existing Keycloak realm without exporting secrets."""
import argparse
import json
import os
from pathlib import Path
import smtplib
import ssl
from urllib.parse import urlparse

import requests


def private_text(path):
    path = Path(path)
    if os.name == 'posix' and path.stat().st_mode & 0o077:
        raise ValueError(f'{path} must be readable only by its owner (chmod 600)')
    return path.read_text(encoding='utf-8')


def load_smtp(path):
    smtp = json.loads(private_text(path))
    for key in ('host', 'port', 'from', 'user', 'password'):
        if not isinstance(smtp.get(key), str) or not smtp[key].strip():
            raise ValueError(f'SMTP setting {key} is required')
    if smtp.get('auth') != 'true':
        raise ValueError('SMTP authentication must be enabled')
    if (smtp.get('ssl') == 'true') == (smtp.get('starttls') == 'true'):
        raise ValueError('Enable exactly one of SMTP SSL or STARTTLS')
    return smtp


def verify_smtp(smtp):
    context = ssl.create_default_context()
    try:
        if smtp['ssl'] == 'true':
            connection = smtplib.SMTP_SSL(smtp['host'], int(smtp['port']), timeout=15, context=context)
        else:
            connection = smtplib.SMTP(smtp['host'], int(smtp['port']), timeout=15)
            connection.starttls(context=context)
        with connection:
            connection.login(smtp['user'], smtp['password'])
    except (smtplib.SMTPException, OSError) as error:
        raise RuntimeError(f'SMTP connection/authentication failed ({type(error).__name__})') from None


def configure_mailer(api):
    """A confidential realm-local service client; no human admin secret in the app."""
    client_id = 'openagents-account-mailer'
    clients = api('GET', '/clients', params={'clientId': client_id}).json()
    if not clients:
        api('POST', '/clients', json={
            'clientId': client_id, 'enabled': True, 'protocol': 'openid-connect',
            'publicClient': False, 'serviceAccountsEnabled': True, 'standardFlowEnabled': False,
            'directAccessGrantsEnabled': False, 'fullScopeAllowed': False, 'defaultClientScopes': ['roles'],
        })
        clients = api('GET', '/clients', params={'clientId': client_id}).json()
    if len(clients) != 1:
        raise ValueError('Expected exactly one openagents-account-mailer client')
    mailer = clients[0]['id']
    api('PUT', '/clients/' + mailer, json={
        'publicClient': False, 'serviceAccountsEnabled': True, 'standardFlowEnabled': False,
        'directAccessGrantsEnabled': False, 'implicitFlowEnabled': False, 'fullScopeAllowed': False,
        'defaultClientScopes': ['roles'],
    })
    management = api('GET', '/clients', params={'clientId': 'realm-management'}).json()
    if len(management) != 1:
        raise ValueError('Expected exactly one realm-management client')
    management_id = management[0]['id']
    role = api('GET', '/clients/' + management_id + '/roles/manage-users').json()
    account = api('GET', '/clients/' + mailer + '/service-account-user').json()
    api('POST', '/users/' + account['id'] + '/role-mappings/clients/' + management_id, json=[role])
    api('POST', '/clients/' + mailer + '/scope-mappings/clients/' + management_id, json=[role])
    return api('GET', '/clients/' + mailer + '/client-secret').json()['value']


def configure(args):
    source = private_text(args.env_file)
    settings = dict(line.split('=', 1) for line in source.splitlines()
                    if line.strip() and not line.lstrip().startswith('#') and '=' in line)
    origin = settings['WORKSPACE_WEB_ORIGIN'].rstrip('/')
    parsed_origin = urlparse(origin)
    if parsed_origin.scheme != 'https' or parsed_origin.path:
        raise ValueError('WORKSPACE_WEB_ORIGIN must be an HTTPS origin without a path')
    parsed_admin = urlparse(args.admin_url)
    if parsed_admin.scheme != 'https' and not (
            parsed_admin.scheme == 'http' and parsed_admin.hostname in ('localhost', '127.0.0.1')):
        raise ValueError('Admin access requires HTTPS or the server loopback interface')
    smtp = None
    if args.enable_registration and not args.smtp_file:
        raise ValueError('--enable-registration requires --smtp-file')
    if args.smtp_file:
        smtp = load_smtp(args.smtp_file)
        verify_smtp(smtp)

    with requests.Session() as session:
        session.trust_env = False
        session.verify = args.ca_cert or True
        base = args.admin_url.rstrip('/')
        response = session.post(base + '/realms/master/protocol/openid-connect/token', data={
            'grant_type': 'password', 'client_id': 'admin-cli',
            'username': settings['KEYCLOAK_ADMIN_USERNAME'],
            'password': settings['KEYCLOAK_ADMIN_PASSWORD'],
        }, timeout=15)
        response.raise_for_status()
        session.headers['Authorization'] = 'Bearer ' + response.json()['access_token']

        def api(method, path, **kwargs):
            response = session.request(method, base + '/admin/realms/openagents' + path, timeout=15, **kwargs)
            response.raise_for_status()
            return response

        realm = api('GET', '').json()
        changes = {'verifyEmail': True, 'resetPasswordAllowed': smtp is not None,
                   'registrationAllowed': bool(args.enable_registration),
                   'passwordPolicy': realm.get('passwordPolicy') or 'length(8)'}
        if smtp is not None:
            changes['smtpServer'] = smtp
        api('PUT', '', json=changes)
        # Remove the previous direct-SSO password override. The application now
        # sends an execute-actions email; a bare AIA cannot overwrite via SSO.
        password_config = api('GET', '/authentication/required-actions/UPDATE_PASSWORD/config').json()
        password_config['config']['max_auth_age'] = '0'
        api('PUT', '/authentication/required-actions/UPDATE_PASSWORD/config', json=password_config)
        mailer_secret = configure_mailer(api) if smtp is not None else settings.get('OIDC_MAILER_CLIENT_SECRET', '')
        clients = api('GET', '/clients', params={'clientId': 'openagents-workspace'}).json()
        if len(clients) != 1:
            raise ValueError('Expected exactly one openagents-workspace client')
        api('PUT', '/clients/' + clients[0]['id'], json={
            'redirectUris': [origin + '/*'], 'webOrigins': [origin],
            'attributes': {**clients[0].get('attributes', {}), 'post.logout.redirect.uris': origin + '/login'},
        })
        configured = api('GET', '').json()
        if configured['verifyEmail'] is not True or configured['registrationAllowed'] is not bool(args.enable_registration):
            raise RuntimeError('Keycloak did not retain the requested registration policy')
        if api('GET', '/authentication/required-actions/UPDATE_PASSWORD/config').json()['config']['max_auth_age'] != '0':
            raise RuntimeError('Keycloak did not retain the requested password update policy')

    updates = {
        'OIDC_REGISTRATION_ENABLED': '1' if args.enable_registration else '0',
        'OIDC_PASSWORD_EMAIL_ENABLED': '1' if smtp is not None else '0',
        'OIDC_MAILER_CLIENT_SECRET': mailer_secret,
        'WORKSPACE_SMTP_CONFIG_FILE': str(Path(args.smtp_file).resolve()) if smtp is not None else '',
    }
    lines = [line for line in source.splitlines() if line.split('=', 1)[0] not in updates]
    Path(args.env_file).write_text('\n'.join([*lines, *(key + '=' + value for key, value in updates.items())]) + '\n', encoding='utf-8')
    print('Keycloak configured: verified-email registration ' + ('enabled' if args.enable_registration else 'closed'))
    print('Password changes require an emailed action link; email service ' + ('enabled' if smtp is not None else 'not configured'))
    print('Rebuild the frontend to apply the registration flag and public origin')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='.env.auth')
    parser.add_argument('--admin-url', default='http://127.0.0.1:8180')
    parser.add_argument('--ca-cert')
    parser.add_argument('--smtp-file')
    parser.add_argument('--enable-registration', action='store_true')
    configure(parser.parse_args())
