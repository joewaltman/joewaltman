# Email setup (Resend on joewaltman.com)

Joe chose to send tool email from the root domain, `joewaltman.com`, rather than a dedicated subdomain. Google Workspace keeps handling Joe's normal mail; Resend only adds sending records, so nothing below touches the existing Google MX or SPF records.

Tradeoff to keep in mind: tool email and Joe's everyday mail now share one domain reputation. If a digest draws spam complaints, it can hurt delivery of Joe's personal email too. Moving to a subdomain later only means adding the domain again in Resend and changing `EMAIL_FROM`.

## Steps

1. Create a Resend account (free tier is enough to start).
2. In Resend, Domains, Add Domain: enter `joewaltman.com`. The default region is fine.
3. Add the DNS records. Easiest: click **Sign in to Cloudflare** on the Resend domain page and let it add them. To add them by hand in Cloudflare DNS for `joewaltman.com`, copy the values Resend shows:

   | Type | Name | Value | Notes |
   |---|---|---|---|
   | MX | `send` | from Resend (an `amazonses.com` host) | Priority 10 |
   | TXT | `send` | from Resend (`v=spf1 include:amazonses.com ~all`) | SPF for the bounce address only |
   | TXT | `resend._domainkey` | from Resend (`p=...`) | DKIM. Proxy status: DNS only |

   Do not edit the root `@` MX or the root SPF record. They belong to Google Workspace.
4. Click **Verify DNS Records** in Resend. It is often done in minutes; it can take longer.
5. In Resend, API Keys: create a key with **Sending access** limited to `joewaltman.com`.
6. In Railway, project `proactive-respect`, environment **staging**, service `joewaltman`, Variables:
   - `RESEND_API_KEY`: the key from step 5
   - `MAIL_POSTAL_ADDRESS`: the mailing address for email footers (a registered PO box is fine)
   - `EMAIL_FROM`: `Joe Waltman <joe@joewaltman.com>` (or another address on the domain)
7. Optional: in the Resend domain settings, turn click tracking off. It rewrites every link, including confirm and unsubscribe links, which can hurt delivery.
8. Tell Claude. It switches staging to `EMAIL_MODE=joe-only`, sends a test signup to joe@joewaltman.com, and checks that SPF, DKIM and DMARC pass in the received headers.

## DMARC

The existing record (`_dmarc.joewaltman.com`, `p=none`, reports to joe@joewaltman.com) already covers Resend mail once DKIM passes. After a few weeks of clean reports, consider moving to `p=quarantine`.
