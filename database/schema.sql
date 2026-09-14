-- ============================================================================
-- SHARK BYTE DISCORD BOT & INFRASTRUCTURE MANAGER DATABASE SCHEMA
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Customers Base Table
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_user_id VARCHAR(32) UNIQUE NOT NULL,
    username VARCHAR(100),
    display_name VARCHAR(100),
    vps_sequence_counter INTEGER NOT NULL DEFAULT 0,
    pterodactyl_user_id INTEGER,
    minecraft_sequence_counter INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_discord_user_id ON customers(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_customers_pterodactyl_user_id ON customers(pterodactyl_user_id) WHERE pterodactyl_user_id IS NOT NULL;

-- 2. Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number BIGSERIAL UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    department VARCHAR(50) NOT NULL,
    status VARCHAR(30) DEFAULT 'open',
    discord_guild_id VARCHAR(32),
    discord_channel_id VARCHAR(32),
    claimed_by_discord_id VARCHAR(32),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

CREATE TABLE IF NOT EXISTS ticket_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    actor_discord_id VARCHAR(32),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_id ON ticket_events(ticket_id);

-- 3. Pricing Plans Catalog
CREATE TABLE IF NOT EXISTS pricing_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(20) NOT NULL DEFAULT 'vps',
    name VARCHAR(100) NOT NULL,
    description TEXT,
    ram_gb INTEGER NOT NULL,
    vcpu INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,
    memory_mb INTEGER,
    cpu_percent INTEGER,
    price_inr NUMERIC(10,2) NOT NULL,
    price_usd NUMERIC(10,2) NOT NULL,
    currency_note VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pricing_plans_category_name UNIQUE (category, name)
);

-- Idempotent column upgrades for existing database
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'vps';
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS memory_mb INTEGER;
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS cpu_percent INTEGER;
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE pricing_plans DROP CONSTRAINT IF EXISTS pricing_plans_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_plans_category_name ON pricing_plans (category, name);

-- Initial Catalog Seed Data (Idempotent)
INSERT INTO pricing_plans (category, name, description, ram_gb, vcpu, storage_gb, memory_mb, cpu_percent, price_inr, price_usd, display_order)
VALUES 
  ('vps', 'NANO', 'Entry-level lightweight Linux container VPS', 1, 1, 10, 1024, 100, 199.00, 2.50, 1),
  ('vps', 'MICRO', 'Standard developer & small application server', 2, 1, 20, 2048, 100, 349.00, 4.20, 2),
  ('vps', 'STANDARD', 'High performance dual-core cloud instance', 4, 2, 40, 4096, 200, 699.00, 8.50, 3),
  ('vps', 'POWER', 'Heavy workload Quad-core production server', 8, 4, 80, 8192, 400, 1299.00, 15.50, 4),
  ('minecraft', 'Starter Minecraft', 'Paper / Java Server for small friend groups', 2, 1, 10, 2048, 100, 199.00, 2.50, 1),
  ('minecraft', 'Pro Minecraft', 'Community server with plugins & modest player count', 4, 2, 20, 4096, 200, 399.00, 5.00, 2),
  ('minecraft', 'Ultimate Minecraft', 'High frequency modded & network hub server', 8, 4, 40, 8192, 400, 799.00, 10.00, 3)
ON CONFLICT (category, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS pricing_ipv4 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    duration_months INTEGER NOT NULL UNIQUE,
    price_inr NUMERIC(10,2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. VPS Instances & Provisioning
CREATE TABLE IF NOT EXISTS vps_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vps_number BIGSERIAL UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    ticket_id UUID UNIQUE REFERENCES tickets(id) ON DELETE RESTRICT,
    plan_id UUID REFERENCES pricing_plans(id) ON DELETE SET NULL,
    plan_name VARCHAR(100) NOT NULL,
    location VARCHAR(50) NOT NULL,
    price_inr NUMERIC(10,2) NOT NULL,
    price_usd NUMERIC(10,2) NOT NULL,
    ram_gb INTEGER NOT NULL,
    vcpu INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,
    provider_instance_id VARCHAR(255) NOT NULL,
    hostname VARCHAR(255) NOT NULL,
    customer_vps_sequence INTEGER,
    instance_name VARCHAR(255),
    public_ipv4 INET,
    private_ipv4 INET,
    ipv6 INET,
    public_ssh_host VARCHAR(255) NOT NULL DEFAULT 'ssh.sharkbyte.com',
    public_ssh_port INTEGER,
    ssh_username VARCHAR(100) NOT NULL DEFAULT 'root',
    ssh_port INTEGER NOT NULL DEFAULT 22,
    billing_cycle_months INTEGER NOT NULL DEFAULT 1,
    billing_source VARCHAR(50) NOT NULL DEFAULT 'paid',
    provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 month'),
    renewal_count INTEGER NOT NULL DEFAULT 0,
    os_id VARCHAR(100),
    virtualization_mode VARCHAR(20) NOT NULL DEFAULT 'standard',
    failure_reason TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    provisioned_by_discord_id VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vps_instances_customer_id ON vps_instances(customer_id);
CREATE INDEX IF NOT EXISTS idx_vps_instances_status ON vps_instances(status);
CREATE INDEX IF NOT EXISTS idx_vps_instances_expires_at ON vps_instances(expires_at);
ALTER TABLE vps_instances ADD COLUMN IF NOT EXISTS os_id VARCHAR(100);
ALTER TABLE vps_instances ADD COLUMN IF NOT EXISTS virtualization_mode VARCHAR(20) NOT NULL DEFAULT 'standard';
ALTER TABLE vps_instances ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE vps_instances DROP CONSTRAINT IF EXISTS vps_instances_virtualization_mode_check;
ALTER TABLE vps_instances ADD CONSTRAINT vps_instances_virtualization_mode_check
  CHECK (virtualization_mode IN ('standard', 'nested'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_vps_instances_customer_sequence ON vps_instances(customer_id, customer_vps_sequence) WHERE customer_vps_sequence IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vps_instances_active_public_ssh_port ON vps_instances(public_ssh_port) WHERE status != 'deleted' AND public_ssh_port IS NOT NULL;

CREATE TABLE IF NOT EXISTS vps_renewals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE RESTRICT,
    billing_cycle_months INTEGER NOT NULL,
    amount_inr NUMERIC(10,2) NOT NULL,
    amount_usd NUMERIC(10,2) NOT NULL,
    previous_expiry TIMESTAMPTZ NOT NULL,
    new_expiry TIMESTAMPTZ NOT NULL,
    renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    renewed_by_discord_id VARCHAR(32) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vps_renewals_vps_id ON vps_renewals(vps_id);

CREATE TABLE IF NOT EXISTS vps_expiry_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
    expiry_date DATE NOT NULL,
    notice_type VARCHAR(30) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(vps_id, expiry_date, notice_type)
);

-- 5. Minecraft Server Instances (Pterodactyl)
CREATE TABLE IF NOT EXISTS minecraft_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_number BIGSERIAL UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    pterodactyl_server_id INTEGER UNIQUE NOT NULL,
    pterodactyl_identifier VARCHAR(50) NOT NULL,
    pterodactyl_user_id INTEGER NOT NULL,
    server_name VARCHAR(255) NOT NULL,
    customer_minecraft_sequence INTEGER NOT NULL,
    plan_id VARCHAR(50) NOT NULL,
    plan_name VARCHAR(100) NOT NULL,
    price_inr NUMERIC(10,2) NOT NULL,
    price_usd NUMERIC(10,2) NOT NULL,
    ram_mb INTEGER NOT NULL,
    cpu_limit INTEGER NOT NULL,
    storage_mb INTEGER NOT NULL,
    allocation_id INTEGER NOT NULL,
    allocation_ip VARCHAR(50) NOT NULL,
    allocation_port INTEGER NOT NULL,
    customer_hostname VARCHAR(255) NOT NULL DEFAULT 'minecraft.sharkbyte.com',
    ssh_username VARCHAR(100) NOT NULL DEFAULT 'root',
    ssh_port INTEGER NOT NULL DEFAULT 22,
    billing_cycle_months INTEGER NOT NULL DEFAULT 1,
    provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 month'),
    renewal_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    provisioned_by_discord_id VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_minecraft_servers_customer_id ON minecraft_servers(customer_id);
CREATE INDEX IF NOT EXISTS idx_minecraft_servers_pterodactyl_server_id ON minecraft_servers(pterodactyl_server_id);
CREATE INDEX IF NOT EXISTS idx_minecraft_servers_status ON minecraft_servers(status);
CREATE INDEX IF NOT EXISTS idx_minecraft_servers_expires_at ON minecraft_servers(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_minecraft_servers_customer_sequence ON minecraft_servers(customer_id, customer_minecraft_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS idx_minecraft_servers_ticket_id ON minecraft_servers(ticket_id) WHERE ticket_id IS NOT NULL;

-- 6. Moderation System
CREATE TABLE IF NOT EXISTS moderation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    matched_rule TEXT NOT NULL,
    message_snapshot TEXT,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_events_user ON moderation_events(guild_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_events_guild ON moderation_events(guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_user_state (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    warning_count INTEGER NOT NULL DEFAULT 0,
    violation_count INTEGER NOT NULL DEFAULT 0,
    last_warning_at TIMESTAMPTZ,
    last_violation_at TIMESTAMPTZ,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS moderation_whitelist (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_by TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, user_id)
);

-- 7. Referral System
CREATE TABLE IF NOT EXISTS referral_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id VARCHAR(32) NOT NULL,
    discord_invite_id VARCHAR(64),
    inviter_discord_user_id VARCHAR(32) NOT NULL,
    invite_code VARCHAR(64) NOT NULL,
    uses_count INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_referral_invites_guild_code UNIQUE (guild_id, invite_code)
);

CREATE INDEX IF NOT EXISTS idx_referral_invites_guild_inviter ON referral_invites(guild_id, inviter_discord_user_id);

CREATE TABLE IF NOT EXISTS referral_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id VARCHAR(32) NOT NULL,
    user_discord_id VARCHAR(32) NOT NULL,
    threshold INTEGER NOT NULL DEFAULT 3,
    reward_plan_name VARCHAR(100) NOT NULL DEFAULT 'NANO',
    status VARCHAR(30) NOT NULL DEFAULT 'available',
    claimed_at TIMESTAMPTZ,
    claimed_vps_id UUID REFERENCES vps_instances(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_user_status ON referral_rewards(guild_id, user_discord_id, status);

CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id VARCHAR(32) NOT NULL,
    inviter_discord_user_id VARCHAR(32) NOT NULL,
    referred_discord_user_id VARCHAR(32) NOT NULL,
    referral_invite_id UUID REFERENCES referral_invites(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    qualified_at TIMESTAMPTZ,
    qualification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    qualification_reason VARCHAR(255),
    qualifying_vps_id UUID REFERENCES vps_instances(id) ON DELETE SET NULL,
    consumed_for_reward_id UUID REFERENCES referral_rewards(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_referrals_guild_referred UNIQUE (guild_id, referred_discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter_status ON referrals(guild_id, inviter_discord_user_id, qualification_status);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_user ON referrals(referred_discord_user_id);

-- 8. Hosting Locations / Nodes Catalog
CREATE TABLE IF NOT EXISTS hosting_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(20) NOT NULL DEFAULT 'both',
    display_name VARCHAR(100) NOT NULL,
    country_code VARCHAR(10) NOT NULL,
    country_flag VARCHAR(10) NOT NULL,
    location_name VARCHAR(100) NOT NULL,
    node_name VARCHAR(100) NOT NULL,
    hostname VARCHAR(255) NOT NULL DEFAULT 'ssh.sharkbyte.com',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hosting_nodes_display_name ON hosting_nodes (display_name);

INSERT INTO hosting_nodes (category, display_name, country_code, country_flag, location_name, node_name, hostname, display_order)
VALUES
  ('both', 'India 🇮🇳', 'IN', '🇮🇳', 'India', 'India-Node-1', 'ssh.sharkbyte.com', 1),
  ('both', 'Germany 🇩🇪', 'DE', '🇩🇪', 'Germany', 'Germany-Node-1', 'de.sharkbyte.com', 2),
  ('both', 'Singapore 🇸🇬', 'SG', '🇸🇬', 'Singapore', 'Singapore-Node-1', 'sg.sharkbyte.com', 3),
  ('both', 'USA 🇺🇸', 'US', '🇺🇸', 'USA', 'USA-Node-1', 'us.sharkbyte.com', 4)
ON CONFLICT (display_name) DO NOTHING;

-- 9. Financial Accounting Ledger & Transactions
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_number BIGSERIAL UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    type VARCHAR(30) NOT NULL DEFAULT 'payment',
    gateway VARCHAR(30) NOT NULL DEFAULT 'manual_staff',
    gateway_transaction_id VARCHAR(255),
    amount_inr NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    amount_usd NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    service_type VARCHAR(30) NOT NULL DEFAULT 'vps',
    plan_name VARCHAR(100),
    notes TEXT,
    recorded_by_discord_id VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_gateway ON transactions(gateway);
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);


