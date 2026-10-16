# HTTP route-policy inventory

Generated from the executable contract policy. Retired media routes are omitted. Request/response shapes are in packages/contract/http/api.ts; current runtime security rules are described in API.md.

| Route | Auth | CSRF | Rate buckets |
| --- | --- | --- | --- |
| `GET /api/health` | none | n/a |  |
| `GET /api/config` | none | n/a |  |
| `GET /api/me` | session | n/a |  |
| `POST /api/register/options` | none | exempt |  |
| `POST /api/register/verify` | none | exempt |  |
| `POST /api/login/options` | none | exempt |  |
| `POST /api/login/verify` | none | exempt |  |
| `POST /api/logout` | none | required |  |
| `POST /api/logout/all` | session | required |  |
| `POST /api/pair/create` | session | required |  |
| `POST /api/pair/redeem` | none | exempt |  |
| `GET /api/account/passkeys` | session | n/a |  |
| `POST /api/account/passkeys/options` | session | required | burst |
| `POST /api/account/passkeys/verify` | session | required |  |
| `POST /api/account/passkeys/rename` | session | required |  |
| `DELETE /api/account/passkeys` | session | required | burst |
| `POST /api/account/device-link` | session | required | burst |
| `POST /api/device-link/options` | none | required | burst, fails:link |
| `POST /api/device-link/verify` | none | required | burst, fails:link |
| `GET /api/account/devices` | session | n/a |  |
| `POST /api/account/devices/rename` | session | required |  |
| `POST /api/account/devices/revoke` | session | required | burst |
| `GET /api/data` | session | n/a |  |
| `GET /api/data/rev` | session | n/a |  |
| `GET /api/data/activity` | session | n/a |  |
| `PUT /api/data` | session | required |  |
| `GET /api/push/public-key` | none | n/a |  |
| `POST /api/push/subscribe` | session | required |  |
| `GET /api/push/status` | session | n/a |  |
| `POST /api/push/unsubscribe` | session | required |  |
| `POST /api/push/test` | session | required |  |
| `POST /api/push/rest-timer` | session | required |  |
| `POST /api/push/rest-timer/cancel` | session | required |  |
| `POST /api/activity` | session | required |  |
| `GET /api/admin/users` | admin | n/a |  |
| `GET /api/admin/user` | admin | n/a |  |
| `POST /api/admin/user/disable` | admin | required |  |
| `POST /api/admin/user/delete` | admin | required |  |
| `GET /api/admin/invites` | admin | n/a |  |
| `POST /api/admin/invites/new` | admin | required |  |
| `POST /api/admin/invites/revoke` | admin | required |  |
| `GET /api/admin/audit` | admin | n/a |  |
| `POST /api/admin/audit/clear` | admin | required |  |
| `GET /api/programmes/library` | session | n/a |  |
| `GET /api/programmes/library/:id` | session | n/a |  |
| `GET /api/programmes/library/:id/versions` | session | n/a |  |
| `PUT /api/programmes/library/:id` | session | required |  |
| `POST /api/programmes/validate` | session | required |  |
| `POST /api/progression/validate` | session | required |  |
| `POST /api/progression/preview` | session | required |  |
| `POST /api/progression/apply` | session | required |  |
