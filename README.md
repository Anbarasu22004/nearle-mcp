# Nearle Daily — connector for Claude and ChatGPT

Search nearby Nearle stores, compare prices and place Cash on Delivery orders from Claude or ChatGPT.
Customers sign in with their mobile number and an SMS OTP. Your backend is not changed.

Pages: `/help` (docs) · `/privacy` (privacy policy) · `/mcp` (connector URL)

## Render environment variables
| Key | Value |
|---|---|
| SECRET_KEY | long random text (already set) |
| HASURA_SECRET | nearle-admin-secret (already set) |
| LIONSMS_KEY | your LionSMS key (same as the app) — turns on OTP |
| REVIEW_PHONE | 7397177923 — test number, signs in without OTP |
| SUPPORT_EMAIL | your support email (shown on /help and /privacy) |

Optional: LIONSMS_SENDER (NEARLE), LIONSMS_TEMPLATE_ID (1107174712357438611), LIONSMS_ROUTE (7),
REVIEW_OTP (if set, the test number must enter this OTP instead).

Without LIONSMS_KEY, login works with the mobile number only (testing).
