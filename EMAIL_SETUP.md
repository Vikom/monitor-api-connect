# Email Configuration Setup

## Overview
The pricelist functionality has been updated to send generated pricelists via email instead of direct download. This improves user experience for large pricelists that may take time to generate.

## Email Provider Setup
We use Office 365 SMTP relay with the following configuration:

- **SMTP Server**: smtp.office365.com
- **Port**: 587
- **Security**: STARTTLS
- **Sender Name**: Webshop Sonsa Business AB
- **Sender Email**: webshop@sonsab.com

## Required Environment Variables

Add these environment variables to your Railway deployment or `.env` file:

```bash
# Email configuration
EMAIL_USER=webshop@sonsab.com
EMAIL_PASSWORD=your_office365_password_here

# Optional: For testing
TEST_EMAIL=your-test-email@example.com
```

## Railway Configuration

In Railway dashboard, add these environment variables:

1. Go to your Railway project
2. Navigate to Variables tab
3. Add the following variables:
   - `EMAIL_USER`: `webshop@sonsab.com`
   - `EMAIL_PASSWORD`: `[your Office 365 password]`

## Testing the Email Configuration

Run the test script to verify email functionality:

```bash
# Set test email first
export TEST_EMAIL=your-email@example.com

# Run the test
node test-email.js
```

The test will:
1. Verify email connection to Office 365
2. Send a test pricelist email with PDF attachment
3. Confirm successful delivery

## How It Works

### Frontend Changes
- Button text changed from "Skapa prislista" to "Skicka prislista via e-post"
- Loading message updated to "Skapar och skickar din prislista..."
- Success message shows email confirmation instead of file download
- Added email info box showing customer's email address

### Backend Changes
- Added `nodemailer` dependency for SMTP functionality
- Created `app/utils/email.js` module for email handling
- Modified `api.pricelist.js` to send emails instead of returning files
- Email includes HTML and text versions with company branding

### Email Content
- Professional HTML email template
- Company branding (Sonsa Business AB)
- Pricelist summary (format, product count, generation time)
- PDF or CSV attachment with timestamp filename
- Sender: webshop@sonsab.com

## Error Handling

The system handles various error scenarios:
- Missing EMAIL_PASSWORD environment variable
- SMTP connection failures
- Email sending failures with detailed error messages
- Fallback to original error messages if email fails

## Security Considerations

- Email password stored as environment variable (not in code)
- STARTTLS encryption for SMTP connection
- No sensitive data in email content (only in secure attachment)
- Proper error handling without exposing credentials

## File Naming Convention

Generated files use timestamp format: `prislista-YYYY-MM-DDTHH-mm-ss.pdf`

Example: `prislista-2025-09-30T14-30-45.pdf`

## Monitoring and Logs

Email sending is logged with:
- Recipient email address
- Attachment filename and size
- Success/failure status
- Message ID for tracking

Check Railway logs for email delivery status.