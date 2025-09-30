import nodemailer from 'nodemailer';

// Email configuration for Office 365
const emailConfig = {
  host: 'smtp.office365.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER || 'webshop@sonsab.com',
    pass: process.env.EMAIL_PASSWORD // This needs to be set in environment variables
  },
  tls: {
    ciphers: 'SSLv3'
  }
};

// Create reusable transporter object using the default SMTP transport
let transporter = null;

/**
 * Get or create email transporter
 */
function getTransporter() {
  if (!transporter) {
    if (!process.env.EMAIL_PASSWORD) {
      throw new Error('EMAIL_PASSWORD environment variable is required for email sending');
    }
    
    transporter = nodemailer.createTransporter(emailConfig);
  }
  return transporter;
}

/**
 * Send pricelist email with attachment
 * @param {string} customerEmail - Customer's email address
 * @param {string} customerCompany - Customer's company name
 * @param {Buffer} attachment - File buffer (PDF or CSV)
 * @param {string} format - File format ('pdf' or 'csv')
 * @param {Array} priceData - Price data for email content
 */
export async function sendPricelistEmail(customerEmail, customerCompany, attachment, format, priceData) {
  try {
    const transporter = getTransporter();
    
    // Generate filename
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `prislista-${timestamp}.${format}`;
    
    // Email content
    const subject = `Din prislista från Sonsa Business AB`;
    
    const htmlContent = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1D349A;">Din prislista är klar!</h2>
            
            <p>Hej${customerCompany ? ` ${customerCompany}` : ''},</p>
            
            <p>Din begärda prislista är nu klar och bifogad till detta e-postmeddelande.</p>
            
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1D349A;">Prislistans innehåll:</h3>
              <ul>
                <li><strong>Format:</strong> ${format.toUpperCase()}</li>
                <li><strong>Antal produkter:</strong> ${priceData.length}</li>
                <li><strong>Skapad:</strong> ${new Date().toLocaleDateString('sv-SE')} ${new Date().toLocaleTimeString('sv-SE')}</li>
              </ul>
            </div>
            
            <p>Du hittar din prislista som bilaga till detta e-postmeddelande.</p>
            
            <p style="margin-top: 30px;">
              <strong>Har du frågor?</strong><br>
              Kontakta oss gärna om du har frågor om prislistan eller våra produkter.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="font-size: 12px; color: #666;">
              Med vänliga hälsningar,<br>
              <strong>Webshop Sonsa Business AB</strong><br>
              webshop@sonsab.com
            </p>
          </div>
        </body>
      </html>
    `;
    
    const textContent = `
Din prislista från Sonsa Business AB

Hej${customerCompany ? ` ${customerCompany}` : ''},

Din begärda prislista är nu klar och bifogad till detta e-postmeddelande.

Prislistans innehåll:
- Format: ${format.toUpperCase()}
- Antal produkter: ${priceData.length}
- Skapad: ${new Date().toLocaleDateString('sv-SE')} ${new Date().toLocaleTimeString('sv-SE')}

Du hittar din prislista som bilaga till detta e-postmeddelande.

Har du frågor?
Kontakta oss gärna om du har frågor om prislistan eller våra produkter.

Med vänliga hälsningar,
Webshop Sonsa Business AB
webshop@sonsab.com
    `;

    // Mail options
    const mailOptions = {
      from: {
        name: 'Webshop Sonsa Business AB',
        address: emailConfig.auth.user
      },
      to: customerEmail,
      subject: subject,
      text: textContent,
      html: htmlContent,
      attachments: [
        {
          filename: filename,
          content: attachment,
          contentType: format === 'pdf' ? 'application/pdf' : 'text/csv'
        }
      ]
    };

    console.log(`Sending pricelist email to: ${customerEmail}`);
    console.log(`Attachment: ${filename} (${attachment.length} bytes)`);
    
    // Send email
    const info = await transporter.sendMail(mailOptions);
    
    console.log('Email sent successfully:', info.messageId);
    return {
      success: true,
      messageId: info.messageId,
      filename: filename
    };
    
  } catch (error) {
    console.error('Error sending pricelist email:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

/**
 * Test email configuration
 */
export async function testEmailConnection() {
  try {
    const transporter = getTransporter();
    await transporter.verify();
    console.log('Email configuration is valid');
    return true;
  } catch (error) {
    console.error('Email configuration test failed:', error);
    return false;
  }
}