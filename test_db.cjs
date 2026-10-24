const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
admin.initializeApp({
  projectId: 'ai-studio-stockportfoliotr-d5beb01d-d8f3-4db5-8034-a3992171a339',
});
const db = getFirestore();

async function run() {
  const ports = await db.collection('portfolios').get();
  console.log("Portfolios:");
  ports.docs.forEach(d => console.log(d.id, d.data()));
  
  const lots = await db.collection('lots').get();
  console.log("Lots count:", lots.docs.length);
}
run();
