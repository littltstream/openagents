"""Bind self-hosted OIDC identities to workspace users without rewriting ACLs."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

deployment_backward_compatible = True
revision = "086"
down_revision = "085"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_identities",
        sa.Column("issuer", sa.Text(), primary_key=True),
        sa.Column("subject", sa.Text(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=False),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("user_id", "issuer", name="uq_user_identities_user_issuer"),
    )


def downgrade():
    op.drop_table("user_identities")
