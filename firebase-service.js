import { validateBookingPayload, validateFeedbackPayload } from './js/data-validation.js';

const config = window.FAB_CONFIG || {};
const firebaseConfig = config.firebase || {};
const SDK_VERSION = '12.1.0';
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
let servicesPromise;

async function getServices() {
  if (!isFirebaseConfigured) return null;
  if (!servicesPromise) {
    servicesPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-check.js`)
    ]).then(([appModule, firestoreModule, authModule, appCheckModule]) => {
      const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
      if (config.appCheckSiteKey) {
        appCheckModule.initializeAppCheck(app, { provider: new appCheckModule.ReCaptchaEnterpriseProvider(config.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
      }
      return { app, db: firestoreModule.getFirestore(app), auth: authModule.getAuth(app), firestoreModule, authModule };
    });
  }
  return servicesPromise;
}

async function userIsAdmin(services, user) {
  if (!user) return false;
  const snapshot = await services.firestoreModule.getDoc(services.firestoreModule.doc(services.db, 'admins', user.uid));
  return snapshot.exists() && snapshot.data()?.active === true;
}

export async function subscribeSlotLocks(
  startDate,
  endDate,
  callback,
  onError = null
) {
  const services = await getServices();

  if (!services) {
    return () => {};
  }

  const { db, firestoreModule: f } =
    services;

  // Ordering is unnecessary because consumers index records by document
  // ID. Omitting orderBy also avoids an avoidable Firestore index failure.
  const query = f.query(
    f.collection(db, 'slotLocks'),
    f.where('date', '>=', startDate),
    f.where('date', '<=', endDate)
  );

  return f.onSnapshot(
    query,
    (snapshot) => {
      const nextLocks = new Map();

      snapshot.forEach((document) => {
        nextLocks.set(document.id, {
          id: document.id,
          ...document.data()
        });
      });

      callback(nextLocks);
    },
    (error) => {
      console.error(
        'Availability subscription failed:',
        error
      );

      // Do not replace existing availability with an
      // empty map because of a temporary connection error.
      if (typeof onError === 'function') {
        onError(error);
      }
    }
  );
}

export async function subscribeAvailabilitySettings(callback) { const s=await getServices(); if(!s)return()=>{}; return s.firestoreModule.onSnapshot(s.firestoreModule.doc(s.db,'settings','availability'),d=>callback(d.exists()?d.data():null),()=>callback(null)); }

export async function submitEnquiry(data) { const s=await getServices(); if(!s)throw new Error('FIREBASE_NOT_CONFIGURED'); const clean={...data,website:data.website||'',status:'new',createdAt:s.firestoreModule.serverTimestamp()}; return (await s.firestoreModule.addDoc(s.firestoreModule.collection(s.db,'enquiries'),clean)).id; }
export async function submitApplication(data) { const s=await getServices(); if(!s)throw new Error('FIREBASE_NOT_CONFIGURED'); return (await s.firestoreModule.addDoc(s.firestoreModule.collection(s.db,'applications'),{...data,status:'new',createdAt:s.firestoreModule.serverTimestamp()})).id; }

export async function signInAdmin(email,password){const s=await getServices();if(!s)throw new Error('FIREBASE_NOT_CONFIGURED');const c=await s.authModule.signInWithEmailAndPassword(s.auth,email,password);if(!(await userIsAdmin(s,c.user))){await s.authModule.signOut(s.auth);throw new Error('ADMIN_REQUIRED');}return c.user;}
export async function signOutAdmin(){const s=await getServices();if(s)await s.authModule.signOut(s.auth);}
export async function watchAdminAuth(callback){const s=await getServices();if(!s){callback(null);return()=>{};}return s.authModule.onAuthStateChanged(s.auth,async u=>callback(u&&await userIsAdmin(s,u)?u:null));}
export async function getAvailabilitySettings(){const s=await getServices();if(!s)return null;const d=await s.firestoreModule.getDoc(s.firestoreModule.doc(s.db,'settings','availability'));return d.exists()?d.data():null;}
export async function saveAvailabilitySettings(data){const s=await getServices();if(!s)throw new Error('FIREBASE_NOT_CONFIGURED');await s.firestoreModule.setDoc(s.firestoreModule.doc(s.db,'settings','availability'),{...data,updatedAt:s.firestoreModule.serverTimestamp()},{merge:true});}

export async function subscribeConfirmationSettings(callback) {
  const s=await getServices();
  if(!s){callback(null);return()=>{};}
  return s.firestoreModule.onSnapshot(s.firestoreModule.doc(s.db,'settings','confirmations'),d=>callback(d.exists()?d.data():null),()=>callback(null));
}
export async function getConfirmationSettings(){const s=await getServices();if(!s)return null;const d=await s.firestoreModule.getDoc(s.firestoreModule.doc(s.db,'settings','confirmations'));return d.exists()?d.data():null;}
export async function saveConfirmationSettings(data){const s=await getServices();if(!s)throw new Error('FIREBASE_NOT_CONFIGURED');await s.firestoreModule.setDoc(s.firestoreModule.doc(s.db,'settings','confirmations'),{...data,updatedAt:s.firestoreModule.serverTimestamp()},{merge:true});}

export async function saveDateBlocks(date,availableSlots,entireDay,defaultSlots,region='greater-manchester'){
  const s=await getServices();if(!s)throw new Error('FIREBASE_NOT_CONFIGURED');const {db,firestoreModule:f}=s;
  const selected=new Map((availableSlots||[]).map(x=>[typeof x==='string'?x:x.id,x]));
  const refs=defaultSlots.map(slot=>f.doc(db,'slotLocks',`${region}_${date}_${slot.id}`));const snapshots=await Promise.all(refs.map(ref=>f.getDoc(ref)));const batch=f.writeBatch(db);
  defaultSlots.forEach((slot,i)=>{const snap=snapshots[i],existing=snap.exists()?snap.data():null;if(existing&&!['available','blocked'].includes(existing.status))return;const custom=selected.get(slot.id),open=entireDay||Boolean(custom);if(open){const times=typeof custom==='object'?custom:slot;batch.set(refs[i],{date,slotId:slot.id,label:slot.label,start:times.start||slot.start,end:times.end||slot.end,region,status:'available',updatedAt:f.serverTimestamp()});}else if(snap.exists())batch.delete(refs[i]);});await batch.commit();
}

export async function saveMonthAvailability(dates, slotIds, defaultSlots, region='greater-manchester') {
  const s=await getServices(); if(!s)throw new Error('FIREBASE_NOT_CONFIGURED');
  const {db,firestoreModule:f}=s;
  const chosen=new Set(slotIds||[]);
  const writes=[];
  for (const date of dates||[]) {
    for (const slot of defaultSlots||[]) {
      if (!chosen.has(slot.id)) continue;
      const ref=f.doc(db,'slotLocks',`${region}_${date}_${slot.id}`);
      const snap=await f.getDoc(ref);
      const existing=snap.exists()?snap.data():null;
      if (existing && !['available','blocked'].includes(existing.status)) continue;
      writes.push({ref,data:{date,slotId:slot.id,label:slot.label,start:slot.start,end:slot.end,region,status:'available'}});
    }
  }
  for (let i=0;i<writes.length;i+=400) {
    const batch=f.writeBatch(db);
    writes.slice(i,i+400).forEach(({ref,data})=>batch.set(ref,{...data,updatedAt:f.serverTimestamp()}));
    await batch.commit();
  }
  return writes.length;
}
export async function updateAdminDocument(collectionName,id,data){const s=await getServices();if(!s)throw new Error('FIREBASE_NOT_CONFIGURED');await s.firestoreModule.updateDoc(s.firestoreModule.doc(s.db,collectionName,id),{...data,updatedAt:s.firestoreModule.serverTimestamp()});}
export async function subscribeAdminCollection(collectionName,callback){const s=await getServices();if(!s)return()=>{};const {db,firestoreModule:f}=s;const q=f.query(f.collection(db,collectionName),f.orderBy('createdAt','desc'),f.limit(100));return f.onSnapshot(q,x=>callback(x.docs.map(d=>({id:d.id,...d.data()}))),e=>{console.error(e);callback([]);});}

export async function subscribeFeedback(callback){const s=await getServices();if(!s){callback([]);return()=>{};}const {db,firestoreModule:f}=s;const q=f.query(f.collection(db,'publicFeedback'),f.orderBy('publishedAt','desc'),f.limit(50));return f.onSnapshot(q,x=>callback(x.docs.map(d=>({id:d.id,...d.data()}))),()=>callback([]));}
export async function saveFeedback(input) {
  const data = validateFeedbackPayload(input);

  const services = await getServices();

  if (!services) {
    throw new Error('FIREBASE_NOT_CONFIGURED');
  }

  const { db, firestoreModule: f } = services;

  try {
    const document = await f.addDoc(
      f.collection(db, 'feedbackSubmissions'),
      {
        name: data.name,
        email: data.email,
        phone: data.phone || '',
        rating: Number(data.rating),
        feedback: data.feedback,
        website: data.website || '',
        status: 'pending',
        createdAt: f.serverTimestamp()
      }
    );

    return document.id;
  } catch (error) {
    console.error('Feedback submission failed:', {
      code: error?.code,
      message: error?.message,
      error
    });

    if (
      error?.code === 'permission-denied' ||
      error?.code === 'firestore/permission-denied'
    ) {
      throw new Error('FEEDBACK_PERMISSION_DENIED');
    }

    if (
      error?.code === 'unavailable' ||
      error?.code === 'firestore/unavailable'
    ) {
      throw new Error('FEEDBACK_SERVICE_UNAVAILABLE');
    }

    throw error;
  }
}
export async function publishFeedback(id,data){const s=await getServices();if(!s)throw new Error('FIREBASE_NOT_CONFIGURED');const {db,firestoreModule:f}=s;const batch=f.writeBatch(db);batch.set(f.doc(db,'publicFeedback',id),{name:data.name,rating:Number(data.rating),feedback:data.feedback,publishedAt:f.serverTimestamp()});batch.update(f.doc(db,'feedbackSubmissions',id),{status:'published',updatedAt:f.serverTimestamp()});await batch.commit();}
export async function unpublishFeedback(id){const s=await getServices();if(!s)throw new Error('FIREBASE_NOT_CONFIGURED');const {db,firestoreModule:f}=s;const batch=f.writeBatch(db);batch.delete(f.doc(db,'publicFeedback',id));batch.update(f.doc(db,'feedbackSubmissions',id),{status:'pending',updatedAt:f.serverTimestamp()});await batch.commit();}
export async function adminDeleteDocument(collectionName,id){const s=await getServices();if(!s)return;await s.firestoreModule.deleteDoc(s.firestoreModule.doc(s.db,collectionName,id));}

// Extended admin data helpers used by the rebuilt operations dashboard.
export async function getAdminProfile(userId) {
  const s = await getServices();
  if (!s || !userId) return null;
  const snap = await s.firestoreModule.getDoc(s.firestoreModule.doc(s.db, 'admins', userId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getAdminDocument(collectionName, id) {
  const s = await getServices();
  if (!s) return null;
  const snap = await s.firestoreModule.getDoc(s.firestoreModule.doc(s.db, collectionName, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function setAdminDocument(collectionName, id, data, merge = true) {
  const s = await getServices();
  if (!s) throw new Error('FIREBASE_NOT_CONFIGURED');
  const payload = { ...data, updatedAt: s.firestoreModule.serverTimestamp() };
  if (!id) {
    const ref = await s.firestoreModule.addDoc(
      s.firestoreModule.collection(s.db, collectionName),
      { ...payload, createdAt: s.firestoreModule.serverTimestamp() }
    );
    return ref.id;
  }
  await s.firestoreModule.setDoc(
    s.firestoreModule.doc(s.db, collectionName, id),
    payload,
    { merge }
  );
  return id;
}

export async function addAdminDocument(collectionName, data) {
  return setAdminDocument(collectionName, '', data, true);
}

export async function subscribeAdminDocument(collectionName, id, callback) {
  const s = await getServices();
  if (!s) { callback(null); return () => {}; }
  return s.firestoreModule.onSnapshot(
    s.firestoreModule.doc(s.db, collectionName, id),
    snap => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    error => { console.error(error); callback(null); }
  );
}

export async function subscribeAdminCollectionFlexible(collectionName, callback, options = {}) {
  const s = await getServices();
  if (!s) { callback([]); return () => {}; }
  const { db, firestoreModule: f } = s;
  const constraints = [];
  if (options.where?.length === 3) constraints.push(f.where(...options.where));
  if (options.orderBy) constraints.push(f.orderBy(options.orderBy, options.direction || 'desc'));
  if (options.limit) constraints.push(f.limit(options.limit));
  const ref = f.collection(db, collectionName);
  const queryRef = constraints.length ? f.query(ref, ...constraints) : ref;
  return f.onSnapshot(
    queryRef,
    snapshot => callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))),
    error => { console.error(`${collectionName} subscription failed`, error); callback([]); }
  );
}

export async function archiveAdminRecord(collectionName, id, reason = '') {
  const s = await getServices();
  if (!s) throw new Error('FIREBASE_NOT_CONFIGURED');
  const { db, firestoreModule: f } = s;
  const sourceRef = f.doc(db, collectionName, id);
  const source = await f.getDoc(sourceRef);
  if (!source.exists()) throw new Error('RECORD_NOT_FOUND');
  const archiveRef = f.doc(f.collection(db, 'archives'));
  const batch = f.writeBatch(db);
  batch.set(archiveRef, {
    sourceCollection: collectionName,
    sourceId: id,
    reason,
    record: source.data(),
    archivedAt: f.serverTimestamp()
  });
  batch.delete(sourceRef);
  await batch.commit();
  return archiveRef.id;
}

export async function restoreArchivedRecord(archiveId) {
  const s = await getServices();
  if (!s) throw new Error('FIREBASE_NOT_CONFIGURED');
  const { db, firestoreModule: f } = s;
  const archiveRef = f.doc(db, 'archives', archiveId);
  const archive = await f.getDoc(archiveRef);
  if (!archive.exists()) throw new Error('ARCHIVE_NOT_FOUND');
  const data = archive.data();
  const batch = f.writeBatch(db);
  batch.set(f.doc(db, data.sourceCollection, data.sourceId), {
    ...data.record,
    restoredAt: f.serverTimestamp(),
    updatedAt: f.serverTimestamp()
  });
  batch.delete(archiveRef);
  await batch.commit();
}

export async function logAdminActivity(action, details = {}) {
  const s = await getServices();
  if (!s) return;
  const user = s.auth.currentUser;
  await s.firestoreModule.addDoc(s.firestoreModule.collection(s.db, 'activityLogs'), {
    action,
    type: details.type || 'general',
    description: details.description || action,
    recordId: details.recordId || '',
    collection: details.collection || '',
    metadata: details.metadata || {},
    adminUid: user?.uid || '',
    adminEmail: user?.email || '',
    createdAt: s.firestoreModule.serverTimestamp()
  });
}

export async function createManualBooking(data) {
  const s = await getServices();
  if (!s) throw new Error('FIREBASE_NOT_CONFIGURED');
  const payload = {
    ...data,
    status: data.status || 'confirmed',
    source: 'admin',
    createdAt: s.firestoreModule.serverTimestamp(),
    updatedAt: s.firestoreModule.serverTimestamp()
  };
  const ref = await s.firestoreModule.addDoc(s.firestoreModule.collection(s.db, 'bookingRequests'), payload);
  return ref.id;
}
