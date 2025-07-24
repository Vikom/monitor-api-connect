import prisma from "./app/db.server.js";

async function clearOldSessions() {
  try {
    const deletedSessions = await prisma.session.deleteMany();
    console.log(`Deleted ${deletedSessions.count} old session(s)`);
    
    const deletedMonitorSessions = await prisma.monitorSession.deleteMany();
    console.log(`Deleted ${deletedMonitorSessions.count} old monitor session(s)`);
    
    console.log("\n✅ All old sessions cleared. You can now re-authenticate your app.");
    
  } catch (error) {
    console.error('Error clearing sessions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearOldSessions();
