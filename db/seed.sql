
-- C4-01: Seed three demonstration tenants

INSERT INTO tenants (name, slug, tier)
VALUES
    ('Green Leaf Coaching', 'tenant_a', 'starter'),
    ('Prime Realty Group', 'tenant_b', 'starter'),
    ('EventSpark Agency', 'tenant_c', 'starter')
ON CONFLICT (slug) DO NOTHING;

-- Verify tenants
SELECT tenant_id, name, slug, tier
FROM tenants
ORDER BY slug;
