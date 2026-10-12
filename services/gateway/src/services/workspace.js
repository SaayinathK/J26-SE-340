'use strict';
const { withTenant } = require('./session');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
async function event(client, user, title, description, icon) {
  await client.query('INSERT INTO workspace_events (tenant_id, user_id, title, description, icon) VALUES ($1,$2,$3,$4,$5)', [user.tenant_id, user.user_id, title, description, icon]);
}
module.exports = { uuid, text, event };
