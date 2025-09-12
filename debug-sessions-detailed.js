// Check session storage and database for debugging
import { sessionStorage } from "./app/shopify.server.js";
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugSessions() {
  try {
    console.log('🔍 Checking session storage...');
    
    // Check Prisma database directly
    const sessions = await prisma.session.findMany();
    console.log(`📦 Found ${sessions.length} sessions in database:`);
    
    sessions.forEach((session, index) => {
      console.log(`  ${index + 1}. ID: ${session.id}`);
      console.log(`     Shop: ${session.shop}`);
      console.log(`     State: ${session.state}`);
      console.log(`     Scope: ${session.scope}`);
      console.log(`     AccessToken: ${session.accessToken ? 'Present' : 'Missing'}`);
      console.log(`     IsOnline: ${session.isOnline}`);
      console.log(`     Expires: ${session.expires}`);
      console.log('');
    });
    
    // Try to find sessions using the sessionStorage API
    const shopSessions = await sessionStorage.findSessionsByShop('mdnjqg-qg.myshopify.com');
    console.log(`🔗 SessionStorage API found: ${shopSessions.length} sessions`);
    
    if (shopSessions.length > 0) {
      console.log('✅ Sessions exist! The issue might be elsewhere.');
    } else {
      console.log('❌ No sessions found via SessionStorage API');
    }
    
  } catch (error) {
    console.error('Error checking sessions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugSessions();
