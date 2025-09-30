import { json } from "@remix-run/node";
import { sendPricelistEmail, testEmailConnection } from "../utils/email.js";
import PDFDocument from "pdfkit";

// Helper function to add CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Handle GET/OPTIONS requests for CORS
export async function loader({ request }) {
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders(),
    });
  }

  // For GET requests, return method not allowed
  return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

export async function action({ request }) {
  const method = request.method;

  if (method !== "POST") {
    return json({ error: "Method not allowed" }, { 
      status: 405,
      headers: corsHeaders()
    });
  }

  try {
    const body = await request.json();
    const { action, email, company } = body;

    console.log('🧪 Email test action:', action);

    if (action === 'test-connection') {
      console.log('🔌 Testing email connection...');
      const isValid = await testEmailConnection();
      
      return json({ 
        success: isValid,
        message: isValid ? 'Email configuration is valid' : 'Email configuration failed'
      }, { 
        status: 200,
        headers: corsHeaders()
      });
      
    } else if (action === 'send-test-email') {
      if (!email) {
        return json({ error: 'Email address is required for test email' }, { 
          status: 400,
          headers: corsHeaders()
        });
      }

      console.log(`📧 Sending test email to: ${email}`);
      
      // Create test PDF
      const testPDF = await createTestPDF(email, company);
      console.log(`📄 Created test PDF: ${testPDF.length} bytes`);
      
      // Create test price data
      const testPriceData = [
        {
          productTitle: 'Test Product 1',
          variantTitle: 'Default',
          sku: 'TEST-001',
          originalPrice: 100,
          customerPrice: 85,
          priceSource: 'test',
          monitorId: 'TEST123',
          standardUnit: 'st',
          width: '100',
          depth: '50',
          length: '2000',
          formattedPrice: '85,00 kr'
        },
        {
          productTitle: 'Test Product 2',
          variantTitle: 'Variant A',
          sku: 'TEST-002',
          originalPrice: 200,
          customerPrice: 180,
          priceSource: 'test',
          monitorId: 'TEST456',
          standardUnit: 'm',
          width: '150',
          depth: '25',
          length: '3000',
          formattedPrice: '180,00 kr'
        }
      ];
      
      // Send test email
      const emailResult = await sendPricelistEmail(
        email,
        company || 'Test Company',
        testPDF,
        'pdf',
        testPriceData
      );
      
      return json({ 
        success: true,
        message: 'Test email sent successfully',
        messageId: emailResult.messageId,
        filename: emailResult.filename
      }, { 
        status: 200,
        headers: corsHeaders()
      });
      
    } else {
      return json({ error: 'Invalid action. Use "test-connection" or "send-test-email"' }, { 
        status: 400,
        headers: corsHeaders()
      });
    }

  } catch (error) {
    console.error('❌ Email test error:', error);
    return json({ 
      error: 'Email test failed', 
      details: error.message 
    }, { 
      status: 500,
      headers: corsHeaders()
    });
  }
}

/**
 * Create a simple test PDF
 */
async function createTestPDF(email, company) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30 });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      
      // Simple test PDF content
      doc.fontSize(16).text('Test Prislista', { align: 'center' });
      doc.fontSize(12).text(`Kund: ${company || 'Test Company'}`, { align: 'center' });
      doc.text(`E-post: ${email}`, { align: 'center' });
      doc.text(`Datum: ${new Date().toLocaleDateString('sv-SE')}`, { align: 'center' });
      doc.moveDown(2);
      
      doc.text('Detta är en test av e-postfunktionaliteten.');
      doc.moveDown();
      doc.text('Test produkter:');
      doc.text('1. Test Product 1 - 85,00 kr');
      doc.text('2. Test Product 2 - 180,00 kr');
      doc.moveDown();
      doc.text('Om du får detta e-postmeddelande fungerar e-postsystemet korrekt!');
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}