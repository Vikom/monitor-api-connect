#!/usr/bin/env node

/**
 * Test script for email functionality
 * This script tests the email configuration and sends a test email
 */

import { testEmailConnection, sendPricelistEmail } from './app/utils/email.js';
import PDFDocument from 'pdfkit';

// Test data
const testCustomerEmail = process.env.TEST_EMAIL || 'test@example.com';
const testCustomerCompany = 'Test Company AB';
const testPriceData = [
  {
    productTitle: 'Test Product 1',
    variantTitle: 'Default',
    sku: 'TEST-001',
    originalPrice: 100,
    customerPrice: 85,
    priceSource: 'customer-specific',
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
    priceSource: 'outlet',
    monitorId: 'TEST456',
    standardUnit: 'm',
    width: '150',
    depth: '25',
    length: '3000',
    formattedPrice: '180,00 kr'
  }
];

console.log('🧪 Testing email configuration...\n');

async function createTestPDF() {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30 });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      
      // Simple test PDF content
      doc.fontSize(16).text('Test Prislista', { align: 'center' });
      doc.fontSize(12).text(`Kund: ${testCustomerCompany}`, { align: 'center' });
      doc.text(`Datum: ${new Date().toLocaleDateString('sv-SE')}`, { align: 'center' });
      doc.moveDown(2);
      
      doc.text('Detta är en test av e-postfunktionaliteten.');
      doc.moveDown();
      doc.text('Produkter:');
      
      testPriceData.forEach((item, index) => {
        doc.text(`${index + 1}. ${item.productTitle} - ${item.formattedPrice}`);
      });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function runTests() {
  try {
    // Check environment variables
    console.log('📋 Environment check:');
    console.log(`   EMAIL_USER: ${process.env.EMAIL_USER || 'NOT SET'}`);
    console.log(`   EMAIL_PASSWORD: ${process.env.EMAIL_PASSWORD ? 'SET' : 'NOT SET'}`);
    console.log(`   TEST_EMAIL: ${process.env.TEST_EMAIL || 'NOT SET'}`);
    console.log('');

    if (!process.env.EMAIL_PASSWORD) {
      console.error('❌ EMAIL_PASSWORD environment variable is required');
      console.log('   Set it in Railway or your .env file');
      process.exit(1);
    }

    // Test 1: Email connection
    console.log('🔌 Testing email connection...');
    const connectionTest = await testEmailConnection();
    if (connectionTest) {
      console.log('✅ Email connection successful');
    } else {
      console.error('❌ Email connection failed');
      process.exit(1);
    }
    console.log('');

    // Test 2: Send test email
    if (process.env.TEST_EMAIL) {
      console.log(`📧 Sending test email to: ${testCustomerEmail}`);
      
      // Create test PDF
      const testPDF = await createTestPDF();
      console.log(`📄 Created test PDF: ${testPDF.length} bytes`);
      
      // Send test email
      const emailResult = await sendPricelistEmail(
        testCustomerEmail,
        testCustomerCompany,
        testPDF,
        'pdf',
        testPriceData
      );
      
      console.log('✅ Test email sent successfully!');
      console.log(`   Message ID: ${emailResult.messageId}`);
      console.log(`   Filename: ${emailResult.filename}`);
    } else {
      console.log('⏭️  Skipping test email send (no TEST_EMAIL set)');
      console.log('   Set TEST_EMAIL environment variable to send a test email');
    }
    
    console.log('\n🎉 All tests passed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run tests
runTests();