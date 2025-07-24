import prisma from "./app/db.server.js";

async function checkSession() {
  try {
    const sessions = await prisma.session.findMany();
    console.log('Sessions found:', sessions.length);
    
    if (sessions.length === 0) {
      console.log('No sessions found in database. You need to authenticate your Shopify app first.');
      return;
    }
    
    sessions.forEach((session, i) => {
      console.log(`Session ${i + 1}:`);
      console.log('  Shop:', session.shop);
      console.log('  Access Token:', session.accessToken ? `Present (${session.accessToken.length} chars)` : 'Missing');
      console.log('  Expires:', session.expires);
      console.log('  Scope:', session.scope);
      console.log('  State:', session.state);
      console.log('  Is Online:', session.isOnline);
      console.log('');
    });
    
    // Check if any session has expired
    const now = new Date();
    const validSessions = sessions.filter(session => !session.expires || session.expires > now);
    console.log(`Valid sessions: ${validSessions.length}`);
    
  } catch (error) {
    console.error('Error checking sessions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSession();
