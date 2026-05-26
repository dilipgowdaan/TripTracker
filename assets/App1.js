import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Modal,
  Animated,
  Dimensions,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Share,
  Alert,
  UIManager,
  LayoutAnimation,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

// --- FIREBASE IMPORTS ---
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  initializeAuth, 
  getAuth,
  getReactNativePersistence, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  addDoc, 
  updateDoc 
} from 'firebase/firestore';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyCzUiV4zL0ME9Y2LFCMMd68BEV4rPZddvw",
  authDomain: "tripplan18.firebaseapp.com",
  projectId: "tripplan18",
  storageBucket: "tripplan18.firebasestorage.app",
  messagingSenderId: "49317668560",
  appId: "1:49317668560:web:aa01ed89a7cd8ae6a260d5",
  measurementId: "G-PN53D2XT3H"
};

// --- SAFE FIREBASE INITIALIZATION ---
// Prevents "Firebase App already exists" crashes during Expo Fast Refresh
let app, auth, db;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
  });
  db = initializeFirestore(app, {
    localCache: memoryLocalCache()
  });
} else {
  app = getApp();
  auth = getAuth(app);
  db = getFirestore(app);
}

// Shared App ID for the GLOBAL user profile store
const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'trip-tracker-global-123';

// --- CONSTANTS & THEME ---
const COLORS = {
  primary: '#0F172A',    
  primaryLight: '#3B82F6',
  accent: '#10B981',     
  background: '#F8FAFC', 
  card: '#FFFFFF',
  textDark: '#1E293B',
  textLight: '#64748B',
  danger: '#EF4444',
  warning: '#F59E0B',
  border: '#E2E8F0',
};

const CATEGORIES = [
  { id: 'Food', icon: '🍔', color: '#F59E0B' },
  { id: 'Fuel', icon: '⛽', color: '#3B82F6' },
  { id: 'Stay', icon: '🛏️', color: '#8B5CF6' },
  { id: 'Other', icon: '📦', color: '#64748B' },
];

const { width } = Dimensions.get('window');

// ==========================================
// MAIN APPLICATION COMPONENT
// ==========================================
function App() {
  // --- AUTH & STATE MANAGEMENT ---
  const [isLocalReady, setIsLocalReady] = useState(false);
  const [authReady, setAuthReady] = useState(false); // TRUE ANTI-FLASH LOCK
  const [user, setUser] = useState(null); 
  const [myName, setMyName] = useState('');
  
  // Trip Management State
  const [myTrips, setMyTrips] = useState([]); 
  const [activeTripId, setActiveTripId] = useState(null);
  const [isTripSetup, setIsTripSetup] = useState(null);
  
  const [currentRoute, setCurrentRoute] = useState('Dashboard'); 
  
  // Active Trip Data
  const [tripData, setTripData] = useState({ 
    name: '', 
    cash: 0, 
    upi: 0, 
    budget: 0, 
    startDate: null 
  });
  const [expenses, setExpenses] = useState([]);
  const [itinerary, setItinerary] = useState([]);
  const [tripmates, setTripmates] = useState([]);
  const [messages, setMessages] = useState([]); 
  const [packingList, setPackingList] = useState([]); 
  
  // UI States
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  
  const menuAnim = useRef(new Animated.Value(-width * 0.8)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // --- 1. LOCAL SETUP (ANTI-FLASH FIX) ---
  useEffect(() => {
    const initLocal = async () => {
      try {
        const storedName = await AsyncStorage.getItem('@my_name');
        if (storedName) {
          setMyName(storedName);
        }

        const storedTrips = await AsyncStorage.getItem('@my_trips');
        let parsedTrips = [];
        if (storedTrips) {
          try { 
            parsedTrips = JSON.parse(storedTrips); 
            if (Array.isArray(parsedTrips)) {
              setMyTrips(parsedTrips);
            }
          } catch(e) {
            console.error("JSON Parse error for trips", e);
          }
        }
        
        const lastActive = await AsyncStorage.getItem('@active_trip_id');
        if (lastActive) {
          setActiveTripId(lastActive);
        } else if (parsedTrips.length > 0) {
          setActiveTripId(parsedTrips[0].id);
        }
      } catch (e) {
        console.error("AsyncStorage Error", e);
      }
      setIsLocalReady(true);
    };
    initLocal();
  }, []);

  // --- 2. FIREBASE AUTHENTICATION LISTENER ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        try {
          const storedName = await AsyncStorage.getItem('@my_name');
          setMyName(currentUser.displayName || storedName || 'Traveler');
        } catch(e) {
          setMyName(currentUser.displayName || 'Traveler');
        }
      } else {
        setUser(null);
      }
      setAuthReady(true); // Tell the app we know who we are (even if offline)
    });
    return () => unsubscribe();
  }, []);

  // --- 3. SYNC GLOBAL USER PROFILE ---
  useEffect(() => {
    if (!user) return;
    
    const profileRef = doc(db, 'artifacts', globalAppId, 'users', user.uid, 'profile', 'info');
    const unsubProfile = onSnapshot(profileRef, async (docSnap) => {
      if (docSnap.exists()) {
        const cloudTrips = docSnap.data().trips || [];
        // Only override if cloud has data, protects against offline nulls
        if (cloudTrips.length >= myTrips.length) {
            setMyTrips(cloudTrips);
            AsyncStorage.setItem('@my_trips', JSON.stringify(cloudTrips));
        }
      } else {
        setDoc(profileRef, { trips: myTrips }).catch(()=>{}); // Non-blocking
      }
    }, (err) => console.log("Profile Sync Offline"));

    return () => unsubProfile();
  }, [user, myTrips.length]);

  // --- 4. REGISTER USER TO ACTIVE TRIP ---
  useEffect(() => {
    if (user && myName && activeTripId) {
      setDoc(doc(db, 'artifacts', activeTripId, 'public', 'data', 'users', user.uid), {
        name: myName, 
        joinedAt: new Date().toISOString()
      }, { merge: true }).catch(()=>{}); // Non-blocking write
    }
  }, [user, myName, activeTripId]);

  // --- 5. TRUE LOCAL CACHE & REAL-TIME DATA SYNC ---
  useEffect(() => {
    if (!user || !activeTripId) return; 
    let isMounted = true;

    // A. INSTANTLY LOAD FROM CACHE (Unblocks the UI immediately offline)
    const loadLocalCache = async () => {
      try {
        const cMain = await AsyncStorage.getItem(`@trip_${activeTripId}_main`);
        if (cMain && isMounted) {
          const data = JSON.parse(cMain);
          setTripData(data);
          setIsTripSetup(data.isSetup || false);
        } else if (isMounted) {
          setIsTripSetup(null); // Truly no data, needs sync
        }

        const cExp = await AsyncStorage.getItem(`@trip_${activeTripId}_expenses`);
        if (cExp && isMounted) setExpenses(JSON.parse(cExp));

        const cItin = await AsyncStorage.getItem(`@trip_${activeTripId}_itinerary`);
        if (cItin && isMounted) setItinerary(JSON.parse(cItin));

        const cMates = await AsyncStorage.getItem(`@trip_${activeTripId}_tripmates`);
        if (cMates && isMounted) setTripmates(JSON.parse(cMates));

        const cMsgs = await AsyncStorage.getItem(`@trip_${activeTripId}_messages`);
        if (cMsgs && isMounted) setMessages(JSON.parse(cMsgs));

        const cPack = await AsyncStorage.getItem(`@trip_${activeTripId}_packingList`);
        if (cPack && isMounted) setPackingList(JSON.parse(cPack));
      } catch(e) {
        console.error("Local Cache Load Error", e);
      }
    };
    
    // Execute cache load immediately!
    loadLocalCache();

    // B. SETUP FIREBASE LISTENERS (Overwrites cache when online)
    const tripRef = doc(db, 'artifacts', activeTripId, 'public', 'data', 'tripData', 'main');
    const unsubTrip = onSnapshot(tripRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setTripData(data);
        setIsTripSetup(data.isSetup || false);
        AsyncStorage.setItem(`@trip_${activeTripId}_main`, JSON.stringify(data));
        
        if (data.name) {
          setMyTrips(prev => {
            const exists = prev.find(t => t.id === activeTripId);
            if (exists && exists.name === data.name) return prev;
            const newTrips = exists 
              ? prev.map(t => t.id === activeTripId ? { ...t, name: data.name } : t)
              : [...prev, { id: activeTripId, name: data.name }];
            
            AsyncStorage.setItem('@my_trips', JSON.stringify(newTrips));
            setDoc(doc(db, 'artifacts', globalAppId, 'users', user.uid, 'profile', 'info'), { trips: newTrips }, { merge: true }).catch(()=>{});
            return newTrips;
          });
        }
      } else {
        setIsTripSetup(false);
      }
    }, (err) => console.log("Main offline/error"));

    const expRef = collection(db, 'artifacts', activeTripId, 'public', 'data', 'expenses');
    const unsubExp = onSnapshot(expRef, (snap) => {
      const exps = []; 
      snap.forEach(d => exps.push(d.data()));
      const sorted = exps.sort((a,b) => new Date(b.date) - new Date(a.date));
      setExpenses(sorted);
      AsyncStorage.setItem(`@trip_${activeTripId}_expenses`, JSON.stringify(sorted));
    }, (err) => console.log("Exp offline"));

    const itinRef = collection(db, 'artifacts', activeTripId, 'public', 'data', 'itinerary');
    const unsubItin = onSnapshot(itinRef, (snap) => {
      const itins = []; 
      snap.forEach(d => itins.push(d.data()));
      const sorted = itins.sort((a,b) => new Date(a.date) - new Date(b.date));
      setItinerary(sorted);
      AsyncStorage.setItem(`@trip_${activeTripId}_itinerary`, JSON.stringify(sorted));
    });

    const usersRef = collection(db, 'artifacts', activeTripId, 'public', 'data', 'users');
    const unsubUsers = onSnapshot(usersRef, (snap) => {
      const matesMap = new Map();
      snap.forEach(d => {
        const data = d.data();
        if (data.name) {
          if (!matesMap.has(data.name) || new Date(data.joinedAt) < new Date(matesMap.get(data.name).joinedAt)) {
            matesMap.set(data.name, { id: d.id, ...data });
          }
        }
      });
      const sorted = Array.from(matesMap.values()).sort((a,b) => new Date(a.joinedAt) - new Date(b.joinedAt));
      setTripmates(sorted);
      AsyncStorage.setItem(`@trip_${activeTripId}_tripmates`, JSON.stringify(sorted));
    });

    const chatRef = collection(db, 'artifacts', activeTripId, 'public', 'data', 'messages');
    const unsubChat = onSnapshot(chatRef, (snap) => {
      const msgs = []; 
      snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
      const sorted = msgs.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
      setMessages(sorted);
      AsyncStorage.setItem(`@trip_${activeTripId}_messages`, JSON.stringify(sorted));
    });

    const packRef = collection(db, 'artifacts', activeTripId, 'public', 'data', 'packingList');
    const unsubPack = onSnapshot(packRef, (snap) => {
      const items = []; 
      snap.forEach(d => items.push({ id: d.id, ...d.data() }));
      const sorted = items.sort((a,b) => a.name.localeCompare(b.name));
      setPackingList(sorted);
      AsyncStorage.setItem(`@trip_${activeTripId}_packingList`, JSON.stringify(sorted));
    });

    return () => { 
      isMounted = false;
      unsubTrip(); 
      unsubExp(); 
      unsubItin(); 
      unsubUsers(); 
      unsubChat(); 
      unsubPack(); 
    };
  }, [user, activeTripId]);

  // --- ACTIONS ---
  const handleSwitchTrip = async (tripId) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTripId(tripId);
    setCurrentRoute('Dashboard');
    await AsyncStorage.setItem('@active_trip_id', tripId);
    closeMenu();
  };

  const handleCreateOrJoinTrip = async (newTripId, name = "New Trip") => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const upperId = newTripId.toUpperCase();
    let newTrips = [...myTrips];
    
    if (!newTrips.find(t => t.id === upperId)) {
      newTrips.push({ id: upperId, name });
    }
    
    setMyTrips(newTrips);
    await AsyncStorage.setItem('@my_trips', JSON.stringify(newTrips));
    
    // Non-blocking cloud save
    setDoc(doc(db, 'artifacts', globalAppId, 'users', user.uid, 'profile', 'info'), { trips: newTrips }, { merge: true }).catch(()=>{});
    
    setActiveTripId(upperId);
    await AsyncStorage.setItem('@active_trip_id', upperId);
    setCurrentRoute('Dashboard');
    closeMenu();
  };

  const handleLeaveTrip = () => {
    Alert.alert(
      "Leave Trip", 
      "Remove this trip from your list? (Data remains for others)", 
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Leave", 
          style: "destructive", 
          onPress: async () => {
            const remaining = myTrips.filter(t => t.id !== activeTripId);
            setMyTrips(remaining);
            await AsyncStorage.setItem('@my_trips', JSON.stringify(remaining));
            
            setDoc(doc(db, 'artifacts', globalAppId, 'users', user.uid, 'profile', 'info'), { trips: remaining }, { merge: true }).catch(()=>{});
            
            if (remaining.length > 0) {
              handleSwitchTrip(remaining[0].id);
            } else {
              setActiveTripId(null); 
              await AsyncStorage.removeItem('@active_trip_id'); 
              closeMenu(); 
            }
          }
        }
      ]
    );
  };

  const handleLogout = async () => {
    Alert.alert(
      "Log Out", 
      "Are you sure you want to log out?", 
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Log Out", 
          style: "destructive", 
          onPress: async () => {
            await signOut(auth);
            setActiveTripId(null);
            setMyTrips([]);
            closeMenu();
          }
        }
      ]
    );
  };

  const handleShareInvite = async () => {
    try { 
      await Share.share({ 
        message: `Join my trip "${tripData.name || 'Trip'}" on the Expense Tracker! \n\nEnter code: ${activeTripId}`, 
      }); 
    } catch (error) {
      console.log("Share error", error);
    }
  };

  // Removed "await" from Data Writing actions below! 
  // This ensures the UI doesn't freeze in an infinite loop while waiting for an offline network connection.
  const handleSendMessage = (text) => {
    if (!text.trim() || !user) return;
    const newMsg = { 
      text: text.trim(), 
      senderId: user.uid, 
      senderName: myName, 
      timestamp: new Date().toISOString() 
    };
    addDoc(collection(db, 'artifacts', activeTripId, 'public', 'data', 'messages'), newMsg).catch(()=>{});
  };

  // --- CALCULATIONS ---
  const totalCapital = parseFloat(tripData.cash) + parseFloat(tripData.upi);
  
  const totalSpent = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
  
  const cashSpent = expenses
    .filter(e => e.method === 'Cash')
    .reduce((sum, e) => sum + parseFloat(e.amount), 0);
    
  const upiSpent = expenses
    .filter(e => e.method === 'UPI')
    .reduce((sum, e) => sum + parseFloat(e.amount), 0);
  
  const remainingCash = parseFloat(tripData.cash) - cashSpent;
  const remainingUPI = parseFloat(tripData.upi) - upiSpent;
  const remainingBalance = totalCapital - totalSpent;
  
  const budgetUsagePercent = tripData.budget > 0 ? (totalSpent / tripData.budget) * 100 : 0;

  // --- NAVIGATION LOGIC ---
  const toggleMenu = () => {
    Keyboard.dismiss();
    if (isMenuOpen) {
      closeMenu();
    } else {
      setIsMenuOpen(true);
      Animated.parallel([
        Animated.timing(menuAnim, { 
          toValue: 0, 
          duration: 300, 
          useNativeDriver: true 
        }),
        Animated.timing(fadeAnim, { 
          toValue: 1, 
          duration: 300, 
          useNativeDriver: true 
        })
      ]).start();
    }
  };

  const closeMenu = () => {
    Animated.parallel([
      Animated.timing(menuAnim, { 
        toValue: -width * 0.8, 
        duration: 250, 
        useNativeDriver: true 
      }),
      Animated.timing(fadeAnim, { 
        toValue: 0, 
        duration: 250, 
        useNativeDriver: true 
      })
    ]).start(() => setIsMenuOpen(false));
  };

  const navigateTo = (route) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCurrentRoute(route);
    closeMenu();
  };

  // --- RENDERING ARCHITECTURE ---

  // 1. Strict Anti-Flash Loading Lock
  if (!isLocalReady || !authReady) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // 2. Auth Screen
  if (!user) {
    return <AuthScreen auth={auth} setMyName={setMyName} />;
  }

  // 3. Main App State
  if (!activeTripId || myTrips.length === 0) {
    return (
      <TripSelectionScreen 
        onSelect={handleCreateOrJoinTrip} 
        userName={myName} 
        onLogout={handleLogout} 
      />
    );
  }

  // 4. Trip Setup Screen
  if (isTripSetup === false) {
    return (
      <SetupScreen 
        onStart={(data) => {
          const newTripData = { 
            ...data, 
            isSetup: true, 
            startDate: new Date().toISOString() 
          };
          setIsTripSetup(true); 
          setDoc(doc(db, 'artifacts', activeTripId, 'public', 'data', 'tripData', 'main'), newTripData).catch(()=>{});
        }} 
      />
    );
  }

  // Only show Syncing if we are absolutely sure the local cache is completely empty.
  if (isTripSetup === null) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={[styles.subText, {marginTop: 10}]}>
          Syncing Trip Data...
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
      
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.menuButton} 
          onPress={toggleMenu} 
          activeOpacity={0.6}
        >
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>{currentRoute}</Text>
        
        <View style={{ width: 40 }} /> 
      </View>

      {/* MAIN CONTENT AREA */}
      <View style={styles.mainContainer}>
        {currentRoute === 'Dashboard' && (
          <DashboardScreen 
            tripName={tripData.name} 
            activeTripId={activeTripId}
            totalCapital={totalCapital} 
            totalSpent={totalSpent} 
            remainingBalance={remainingBalance}
            remainingCash={remainingCash} 
            remainingUPI={remainingUPI} 
            budget={tripData.budget}
            budgetUsagePercent={budgetUsagePercent} 
            onAddExpense={(cat) => setIsAddExpenseOpen(cat || true)}
          />
        )}
        
        {currentRoute === 'History' && (
          <HistoryScreen expenses={expenses} />
        )}
        
        {currentRoute === 'Analytics' && (
          <AnalyticsScreen 
            totalCapital={totalCapital} 
            totalSpent={totalSpent} 
            remainingBalance={remainingBalance} 
            remainingCash={remainingCash} 
            remainingUPI={remainingUPI} 
            expenses={expenses} 
            tripName={tripData.name}
          />
        )}
        
        {currentRoute === 'Itinerary' && (
          <ItineraryScreen 
            itinerary={itinerary} 
            startDate={tripData.startDate} 
            myName={myName}
            onSave={(newItem) => {
              setDoc(doc(db, 'artifacts', activeTripId, 'public', 'data', 'itinerary', newItem.id), newItem).catch(()=>{});
            }}
            onDelete={(id) => {
              deleteDoc(doc(db, 'artifacts', activeTripId, 'public', 'data', 'itinerary', id)).catch(()=>{});
            }}
          />
        )}
        
        {currentRoute === 'Tripmates' && (
          <TripmatesScreen 
            tripmates={tripmates} 
            tripName={tripData.name} 
          />
        )}
        
        {currentRoute === 'Chat' && (
          <ChatScreen 
            messages={messages} 
            user={user} 
            myName={myName} 
            onSend={handleSendMessage} 
          />
        )}
        
        {currentRoute === 'PackingList' && (
          <PackingListScreen 
            packingList={packingList} 
            myName={myName} 
            activeTripId={activeTripId} 
            db={db} 
          />
        )}
      </View>

      {/* FLOATING ACTION BUTTON */}
      {currentRoute === 'Dashboard' && (
        <TouchableOpacity 
          style={styles.fab} 
          onPress={() => setIsAddExpenseOpen(true)} 
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}

      {/* ADD EXPENSE MODAL */}
      <AddExpenseModal 
        visible={!!isAddExpenseOpen} 
        initialCategory={typeof isAddExpenseOpen === 'string' ? isAddExpenseOpen : null}
        onClose={() => setIsAddExpenseOpen(false)} 
        remainingCash={remainingCash} 
        remainingUPI={remainingUPI} 
        myName={myName}
        onSave={(expenseData) => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
          const newExpense = { 
            id: Date.now().toString(), 
            date: new Date().toISOString(), 
            ...expenseData 
          };
          setIsAddExpenseOpen(false);
          
          // Non-blocking writes so offline doesn't freeze!
          setDoc(doc(db, 'artifacts', activeTripId, 'public', 'data', 'expenses', newExpense.id), newExpense).catch(()=>{});
          
          const msg = `💸 Added expense: ₹${expenseData.amount} for ${expenseData.desc} (${expenseData.category})`;
          addDoc(collection(db, 'artifacts', activeTripId, 'public', 'data', 'messages'), { 
            text: msg, 
            senderId: 'SYSTEM', 
            senderName: myName, 
            timestamp: new Date().toISOString() 
          }).catch(()=>{});
        }}
      />

      {/* HAMBURGER DRAWER OVERLAY */}
      {isMenuOpen && (
        <Animated.View style={[styles.menuOverlay, { opacity: fadeAnim }]}>
          <TouchableOpacity 
            style={{ flex: 1 }} 
            onPress={closeMenu} 
            activeOpacity={1} 
          />
        </Animated.View>
      )}
      
      {/* HAMBURGER DRAWER MENU */}
      <Animated.View style={[styles.drawer, { transform: [{ translateX: menuAnim }] }]}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle} numberOfLines={1}>
                {tripData.name || 'Trip Menu'}
              </Text>
              <Text style={styles.drawerSub}>
                Hi, {myName}
              </Text>
            </View>

            <View style={{ paddingBottom: 10 }}>
              <DrawerItem 
                icon="📊" 
                title="Dashboard" 
                active={currentRoute === 'Dashboard'} 
                onPress={() => navigateTo('Dashboard')} 
              />
              <DrawerItem 
                icon="🎒" 
                title="Packing List" 
                active={currentRoute === 'PackingList'} 
                onPress={() => navigateTo('PackingList')} 
              />
              <DrawerItem 
                icon="💬" 
                title="Group Chat" 
                active={currentRoute === 'Chat'} 
                onPress={() => navigateTo('Chat')} 
              />
              <DrawerItem 
                icon="📅" 
                title="Itinerary" 
                active={currentRoute === 'Itinerary'} 
                onPress={() => navigateTo('Itinerary')} 
              />
              <DrawerItem 
                icon="🕒" 
                title="History" 
                active={currentRoute === 'History'} 
                onPress={() => navigateTo('History')} 
              />
              <DrawerItem 
                icon="📈" 
                title="Analytics" 
                active={currentRoute === 'Analytics'} 
                onPress={() => navigateTo('Analytics')} 
              />
              <DrawerItem 
                icon="👥" 
                title="Tripmates" 
                active={currentRoute === 'Tripmates'} 
                onPress={() => navigateTo('Tripmates')} 
              />
            </View>

            {/* MULTI-TRIP SECTION */}
            <View style={styles.multiTripSection}>
              <Text style={styles.multiTripTitle}>YOUR TRIPS</Text>
              
              {myTrips.map(t => (
                <TouchableOpacity 
                  key={t.id} 
                  style={[styles.tripSelectItem, t.id === activeTripId && styles.tripSelectItemActive]} 
                  onPress={() => handleSwitchTrip(t.id)}
                >
                  <Text 
                    style={[styles.tripSelectText, t.id === activeTripId && { color: COLORS.primary, fontWeight: 'bold' }]} 
                    numberOfLines={1}
                  >
                    {t.id === activeTripId ? '📍 ' : '✈️ '} {t.name || t.id}
                  </Text>
                </TouchableOpacity>
              ))}
              
              <TouchableOpacity 
                style={styles.newTripBtn} 
                onPress={() => { closeMenu(); setActiveTripId(null); }}
              >
                <Text style={styles.newTripBtnText}>+ Create / Join Trip</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.drawerDivider} />
            
            <DrawerItem 
              icon="🔗" 
              title="Invite Friends" 
              onPress={handleShareInvite} 
            />
            <DrawerItem 
              icon="🚪" 
              title="Leave Trip" 
              color={COLORS.warning} 
              onPress={handleLeaveTrip} 
            />
            <DrawerItem 
              icon="🔒" 
              title="Log Out" 
              color={COLORS.textLight} 
              onPress={handleLogout} 
            />
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
      
    </SafeAreaView>
  );
}

// ==========================================
// DRAWER ITEM COMPONENT
// ==========================================
const DrawerItem = ({ icon, title, active, color, onPress }) => (
  <TouchableOpacity 
    style={[styles.drawerItem, active && styles.drawerItemActive]} 
    onPress={onPress} 
    activeOpacity={0.7}
  >
    <Text style={styles.drawerItemIcon}>{icon}</Text>
    <Text style={[styles.drawerItemText, color && { color }, active && { color: COLORS.accent, fontWeight: 'bold' }]}>
      {title}
    </Text>
  </TouchableOpacity>
);

// ==========================================
// AUTH SCREEN
// ==========================================
function AuthScreen({ auth, setMyName }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) {
      return Alert.alert("Error", "Please enter email and password.");
    }
    
    setLoading(true);
    
    try {
      if (isLogin) {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        const dName = cred.user.displayName || 'Traveler';
        setMyName(dName);
        await AsyncStorage.setItem('@my_name', dName);
      } else {
        if (!name.trim()) { 
          setLoading(false); 
          return Alert.alert("Error", "Please enter your Display Name."); 
        }
        setMyName(name.trim());
        await AsyncStorage.setItem('@my_name', name.trim());
        
        const userCred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(userCred.user, { displayName: name.trim() });
      }
    } catch (e) {
      Alert.alert("Authentication Failed", e.message);
    }
    
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.setupContainer} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{flex: 1}}
      >
        <ScrollView contentContainerStyle={styles.setupScroll} bounces={false}>
          <View style={styles.setupHeader}>
            <Text style={styles.setupTitle}>Welcome to</Text>
            <Text style={styles.setupBrand}>Trip Tracker</Text>
            <Text style={styles.setupSub}>
              {isLogin ? "Log in to access your trips across devices." : "Create an account to save your trips forever."}
            </Text>
          </View>
          
          <View style={styles.card}>
            {!isLogin && (
              <>
                <Text style={styles.inputLabel}>Display Name</Text>
                <TextInput 
                  style={styles.input} 
                  placeholder="e.g. Rahul" 
                  value={name} 
                  onChangeText={setName} 
                  placeholderTextColor={COLORS.textLight} 
                />
              </>
            )}
            
            <Text style={styles.inputLabel}>Email Address</Text>
            <TextInput 
              style={styles.input} 
              placeholder="you@email.com" 
              value={email} 
              onChangeText={setEmail} 
              keyboardType="email-address" 
              autoCapitalize="none" 
              placeholderTextColor={COLORS.textLight} 
            />
            
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput 
              style={styles.input} 
              placeholder="••••••••" 
              value={password} 
              onChangeText={setPassword} 
              secureTextEntry 
              placeholderTextColor={COLORS.textLight} 
            />
            
            <TouchableOpacity 
              style={[styles.primaryButton, {marginTop: 20}]} 
              activeOpacity={0.8} 
              onPress={handleSubmit} 
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isLogin ? "LOG IN" : "SIGN UP"}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={{ alignItems: 'center', marginTop: 10 }} 
            onPress={() => setIsLogin(!isLogin)}
          >
            <Text style={{ color: COLORS.primaryLight, fontSize: 16, fontWeight: 'bold' }}>
              {isLogin ? "Need an account? Sign Up" : "Already have an account? Log In"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ==========================================
// TRIP SELECTION SCREEN
// ==========================================
function TripSelectionScreen({ onSelect, userName, onLogout }) {
  const [joinCode, setJoinCode] = useState('');

  const handleCreate = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    onSelect(code, "New Trip");
  };

  const handleJoin = () => {
    if (joinCode.trim().length < 4) {
      return Alert.alert("Invalid Code", "Please enter a valid trip code.");
    }
    onSelect(joinCode.trim().toUpperCase(), "Syncing Trip...");
  };

  return (
    <SafeAreaView style={styles.setupContainer} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{flex: 1}}
      >
        <ScrollView contentContainerStyle={styles.setupScroll} bounces={false}>
          
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
            <View>
              <Text style={styles.setupTitle}>Hi, {userName}</Text>
              <Text style={styles.setupBrand}>Trip Tracker</Text>
            </View>
            <TouchableOpacity 
              onPress={onLogout} 
              style={{padding: 8, backgroundColor: COLORS.border, borderRadius: 8}}
            >
              <Text style={{color: COLORS.textDark, fontWeight: 'bold'}}>Logout</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.setupSub}>Manage multiple shared trips seamlessly.</Text>

          <View style={[styles.card, { marginTop: 40 }]}>
            <Text style={[styles.sectionTitle, { textAlign: 'center' }]}>Create a New Trip</Text>
            <Text style={[styles.subText, { marginBottom: 20 }]}>Start a fresh common fund pool and invite your friends.</Text>
            <TouchableOpacity 
              style={styles.primaryButton} 
              onPress={handleCreate} 
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>➕ CREATE NEW TRIP</Text>
            </TouchableOpacity>
          </View>

          <Text style={{ textAlign: 'center', fontSize: 18, color: COLORS.textLight, marginVertical: 10, fontWeight: 'bold' }}>
            OR
          </Text>

          <View style={styles.card}>
            <Text style={[styles.sectionTitle, { textAlign: 'center' }]}>Join Existing Trip</Text>
            <Text style={[styles.subText, { marginBottom: 15 }]}>Enter the invite code from your friend.</Text>
            <TextInput
              style={[styles.input, { textAlign: 'center', fontSize: 24, letterSpacing: 2, textTransform: 'uppercase' }]} 
              placeholder="e.g. X8K2M9"
              value={joinCode} 
              onChangeText={setJoinCode} 
              placeholderTextColor={COLORS.textLight}
              autoCapitalize="characters"
            />
            <TouchableOpacity 
              style={[styles.primaryButton, { backgroundColor: COLORS.primary, marginTop: 15 }]} 
              onPress={handleJoin} 
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>JOIN TRIP</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ==========================================
// ITINERARY SCREEN
// ==========================================
function ItineraryScreen({ itinerary, startDate, myName, onSave, onDelete }) {
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);

  const calendarDays = React.useMemo(() => {
    const days = []; 
    const baseDate = startDate ? new Date(startDate) : new Date();
    
    for (let i = 0; i < 60; i++) {
      const d = new Date(baseDate); 
      d.setDate(d.getDate() + i);
      
      days.push({ 
        dateObj: d, 
        dayStr: d.toLocaleDateString('en-US', { weekday: 'short' }), 
        dateNum: d.getDate(), 
        monthStr: d.toLocaleDateString('en-US', { month: 'short' }), 
        fullStr: d.toISOString().split('T')[0] 
      });
    }
    
    return days;
  }, [startDate]);

  useEffect(() => { 
    if (!selectedDateStr && calendarDays.length > 0) {
      setSelectedDateStr(calendarDays[0].fullStr); 
    }
  }, [calendarDays, selectedDateStr]);

  const handleDateSelect = (dateStr) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedDateStr(dateStr);
  };

  const todaysItinerary = itinerary.filter(item => item.date === selectedDateStr);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.calendarStripContainer}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          {calendarDays.map((day, idx) => {
            const isActive = day.fullStr === selectedDateStr;
            return (
              <TouchableOpacity 
                key={idx} 
                style={[styles.calendarDayCard, isActive && styles.calendarDayCardActive]} 
                onPress={() => handleDateSelect(day.fullStr)} 
                activeOpacity={0.7}
              >
                <Text style={[styles.calMonthText, isActive && styles.calTextActive]}>
                  {day.monthStr}
                </Text>
                <Text style={[styles.calNumText, isActive && styles.calTextActive]}>
                  {day.dateNum}
                </Text>
                <Text style={[styles.calDayText, isActive && styles.calTextActive]}>
                  {day.dayStr}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView style={styles.screenScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.itineraryHeader}>
          <Text style={styles.sectionTitle}>
            Plans for {new Date(selectedDateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric'})}
          </Text>
        </View>
        
        {todaysItinerary.length === 0 ? (
          <View style={styles.emptyItinerary}>
            <Text style={{ fontSize: 40, marginBottom: 10 }}>🌴</Text>
            <Text style={styles.subText}>No plans yet. Free day!</Text>
          </View>
        ) : (
          <View style={styles.timelineContainer}>
            {todaysItinerary.map((item, i) => {
              const isLast = i === todaysItinerary.length - 1;
              return (
                <View key={item.id} style={styles.timelineItem}>
                  <View style={styles.timelineGraphic}>
                    <View style={[styles.timelineDot, { backgroundColor: COLORS.accent }]} />
                    {!isLast && <View style={styles.timelineLine} />}
                  </View>
                  <View style={styles.itineraryCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itineraryTime}>{item.time}</Text>
                      <Text style={styles.itineraryTitle}>{item.title}</Text>
                      {item.desc ? (
                        <Text style={styles.itineraryDesc}>{item.desc}</Text>
                      ) : null}
                      <Text style={styles.addedByText}>Planned by {item.addedBy || 'Unknown'}</Text>
                    </View>
                    <TouchableOpacity 
                      onPress={() => onDelete(item.id)} 
                      style={{ padding: 5, paddingLeft: 10 }}
                    >
                      <Text style={{ color: COLORS.danger, fontSize: 18 }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      <TouchableOpacity 
        style={styles.fab} 
        onPress={() => setIsAddOpen(true)} 
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <AddItineraryModal 
        visible={isAddOpen} 
        selectedDate={selectedDateStr} 
        myName={myName} 
        onClose={() => setIsAddOpen(false)} 
        onSave={(data) => { 
          onSave(data); 
          setIsAddOpen(false); 
        }} 
      />
    </View>
  );
}

// ==========================================
// ADD ITINERARY MODAL
// ==========================================
function AddItineraryModal({ visible, selectedDate, myName, onClose, onSave }) {
  const [time, setTime] = useState(''); 
  const [title, setTitle] = useState(''); 
  const [desc, setDesc] = useState('');
  
  useEffect(() => { 
    if (visible) { 
      setTime(''); 
      setTitle(''); 
      setDesc(''); 
    } 
  }, [visible]);

  const handleSave = () => {
    if(!title) {
      return Alert.alert("Hold on!", "Please enter a title for the activity.");
    }
    
    onSave({ 
      id: Date.now().toString(), 
      date: selectedDate, 
      time: time || 'Anytime', 
      title, 
      desc, 
      addedBy: myName 
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={styles.modalContent}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Plan</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.inputLabel}>Time (e.g., 10:30 AM)</Text>
            <TextInput 
              style={styles.textInput} 
              placeholder="When?" 
              value={time} 
              onChangeText={setTime} 
              placeholderTextColor={COLORS.textLight} 
            />
            
            <Text style={styles.inputLabel}>Activity / Title</Text>
            <TextInput 
              style={styles.textInput} 
              placeholder="What are we doing?" 
              value={title} 
              onChangeText={setTitle} 
              placeholderTextColor={COLORS.textLight} 
            />
            
            <Text style={styles.inputLabel}>Location / Description (Optional)</Text>
            <TextInput 
              style={styles.textInput} 
              placeholder="Where is it?" 
              value={desc} 
              onChangeText={setDesc} 
              placeholderTextColor={COLORS.textLight} 
            />
            
            <TouchableOpacity 
              style={[styles.primaryButton, { backgroundColor: COLORS.primary }]} 
              onPress={handleSave}
            >
              <Text style={styles.primaryButtonText}>SAVE PLAN</Text>
            </TouchableOpacity>
            
            <View style={{height: 40}}/>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ==========================================
// PACKING LIST SCREEN
// ==========================================
function PackingListScreen({ packingList, myName, activeTripId, db }) {
  const [newItem, setNewItem] = useState('');

  const handleAddItem = () => {
    if (!newItem.trim()) return;
    
    const item = { 
      name: newItem.trim(), 
      claimedBy: null, 
      packed: false, 
      addedBy: myName, 
      timestamp: new Date().toISOString() 
    };
    
    addDoc(collection(db, 'artifacts', activeTripId, 'public', 'data', 'packingList'), item).catch(()=>{});
    setNewItem('');
    Keyboard.dismiss();
  };

  const handleToggleClaim = (item) => {
    const itemRef = doc(db, 'artifacts', activeTripId, 'public', 'data', 'packingList', item.id);
    
    if (!item.claimedBy) {
      updateDoc(itemRef, { claimedBy: myName }).catch(()=>{}); 
    } else if (item.claimedBy === myName) {
      updateDoc(itemRef, { packed: !item.packed }).catch(()=>{}); 
    } else {
      Alert.alert("Already Claimed", `This item is claimed by ${item.claimedBy}.`);
    }
  };

  const handleLongPress = (item) => {
    if (item.claimedBy === myName) {
      Alert.alert(
        "Unclaim Item", 
        "Do you want to put this back in the pool?", 
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "Unclaim", 
            onPress: () => {
              updateDoc(doc(db, 'artifacts', activeTripId, 'public', 'data', 'packingList', item.id), { 
                claimedBy: null, 
                packed: false 
              }).catch(()=>{});
            }
          }
        ]
      );
    }
  };

  const renderItem = ({ item }) => {
    const isMine = item.claimedBy === myName;
    const isClaimed = !!item.claimedBy;
    
    return (
      <TouchableOpacity 
        style={[styles.packItem, isMine && styles.packItemMine, item.packed && styles.packItemPacked]} 
        onPress={() => handleToggleClaim(item)}
        onLongPress={() => handleLongPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.packCheckbox}>
          {item.packed ? (
            <Text style={{color: '#FFF', fontWeight: 'bold'}}>✓</Text>
          ) : null}
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.packName, item.packed && styles.packNamePacked]}>
            {item.name}
          </Text>
          <Text style={styles.packSub}>
            {isClaimed ? (isMine ? 'Claimed by you (Hold to unclaim)' : `Claimed by ${item.claimedBy}`) : 'Tap to claim & bring this'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
      style={{ flex: 1 }} 
      keyboardVerticalOffset={90}
    >
      <View style={styles.packInputContainer}>
        <TextInput 
          style={styles.packInput} 
          placeholder="Add to packing list..." 
          value={newItem} 
          onChangeText={setNewItem} 
          placeholderTextColor={COLORS.textLight} 
        />
        <TouchableOpacity style={styles.packAddBtn} onPress={handleAddItem}>
          <Text style={styles.packAddText}>Add</Text>
        </TouchableOpacity>
      </View>
      
      <FlatList
        data={packingList}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.subText}>List is empty. What should we bring?</Text>
        }
      />
    </KeyboardAvoidingView>
  );
}

// ==========================================
// CHAT SCREEN
// ==========================================
function ChatScreen({ messages, user, myName, onSend }) {
  const [text, setText] = useState('');
  const flatListRef = useRef(null);

  const handleSend = () => { 
    if (text.trim() !== '') { 
      onSend(text); 
      setText(''); 
    } 
  };

  const renderItem = ({ item }) => {
    const isMe = item.senderId === user?.uid || item.senderName === myName;
    const isSystem = item.senderId === 'SYSTEM';

    if (isSystem) {
      return (
        <View style={styles.sysMsgContainer}>
          <Text style={styles.sysMsgText}>
            {item.senderName} {item.text}
          </Text>
        </View>
      );
    }
    
    return (
      <View style={[styles.msgWrapper, isMe ? styles.msgWrapperMe : styles.msgWrapperOther]}>
        {!isMe && (
          <Text style={styles.msgSenderName}>{item.senderName}</Text>
        )}
        
        <View style={[styles.msgBubble, isMe ? styles.msgBubbleMe : styles.msgBubbleOther]}>
          <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextOther]}>
            {item.text}
          </Text>
        </View>
        
        <Text style={styles.msgTime}>
          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
      style={{ flex: 1, backgroundColor: COLORS.background }} 
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={flatListRef} 
        data={messages} 
        keyExtractor={(item) => item.id} 
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 20 }} 
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />
      <View style={styles.chatInputContainer}>
        <TextInput 
          style={styles.chatInput} 
          placeholder="Type a message..." 
          value={text} 
          onChangeText={setText} 
          placeholderTextColor={COLORS.textLight} 
          multiline 
        />
        <TouchableOpacity style={styles.chatSendBtn} onPress={handleSend} activeOpacity={0.7}>
          <Text style={styles.chatSendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ==========================================
// SETUP SCREEN
// ==========================================
function SetupScreen({ onStart }) {
  const [tripName, setTripName] = useState('');
  const [cash, setCash] = useState('');
  const [upi, setUpi] = useState('');
  const [budget, setBudget] = useState('');

  const handleStart = () => {
    if (!tripName.trim()) {
      return Alert.alert("Hold on!", "Please give your trip a nice name first.");
    }
    
    const cashAmt = parseFloat(cash) || 0;
    const upiAmt = parseFloat(upi) || 0;
    const budgetAmt = parseFloat(budget) || 0;
    
    if (cashAmt === 0 && upiAmt === 0) {
      return Alert.alert("Hold on!", "Please enter at least some Cash or UPI amount.");
    }
    
    onStart({ 
      name: tripName.trim(), 
      cash: cashAmt, 
      upi: upiAmt, 
      budget: budgetAmt 
    });
  };

  return (
    <SafeAreaView style={styles.setupContainer} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{flex: 1}}
      >
        <ScrollView contentContainerStyle={styles.setupScroll} bounces={false}>
          <View style={styles.setupHeader}>
            <Text style={styles.setupTitle}>Configure Trip</Text>
            <Text style={styles.setupBrand}>Common Fund</Text>
            <Text style={styles.setupSub}>
              Set up the shared wallet. Data will sync across all friends' devices instantly!
            </Text>
          </View>
          
          <View style={styles.card}>
            <Text style={styles.inputLabel}>Trip Name</Text>
            <TextInput 
              style={styles.input} 
              placeholder="e.g. Goa 2026, Manali Trip..." 
              value={tripName} 
              onChangeText={setTripName} 
              placeholderTextColor={COLORS.textLight} 
            />
            
            <Text style={styles.inputLabel}>Cash Amount Collected (₹)</Text>
            <TextInput 
              style={styles.input} 
              keyboardType="numeric" 
              placeholder="e.g. 20000" 
              value={cash} 
              onChangeText={setCash} 
              placeholderTextColor={COLORS.textLight} 
            />
            
            <Text style={styles.inputLabel}>UPI Amount Collected (₹)</Text>
            <TextInput 
              style={styles.input} 
              keyboardType="numeric" 
              placeholder="e.g. 30000" 
              value={upi} 
              onChangeText={setUpi} 
              placeholderTextColor={COLORS.textLight} 
            />
            
            <Text style={styles.inputLabel}>Optional Trip Budget (₹)</Text>
            <TextInput 
              style={styles.input} 
              keyboardType="numeric" 
              placeholder="Total budget limit" 
              value={budget} 
              onChangeText={setBudget} 
              placeholderTextColor={COLORS.textLight} 
            />
          </View>
          
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Total Starting Capital</Text>
            <Text style={styles.summaryText}>
              ₹{((parseFloat(cash)||0) + (parseFloat(upi)||0)).toFixed(2)}
            </Text>
          </View>
          
          <TouchableOpacity 
            style={styles.primaryButton} 
            onPress={handleStart} 
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>START TRIP ✈️</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ==========================================
// ADD EXPENSE MODAL
// ==========================================
function AddExpenseModal({ visible, initialCategory, myName, onClose, onSave, remainingCash, remainingUPI }) {
  const [amount, setAmount] = useState(''); 
  const [category, setCategory] = useState(CATEGORIES[0].id); 
  const [method, setMethod] = useState('UPI'); 
  const [desc, setDesc] = useState('');

  useEffect(() => { 
    if (visible) { 
      setAmount(''); 
      setCategory(initialCategory || CATEGORIES[0].id); 
      setMethod('UPI'); 
      setDesc(''); 
    } 
  }, [visible, initialCategory]);

  const handleSave = () => {
    if (!amount || isNaN(parseFloat(amount))) {
      return Alert.alert("Error", "Enter valid amount.");
    }
    onSave({ 
      amount: parseFloat(amount), 
      category, 
      method, 
      desc: desc.trim() || category, 
      addedBy: myName 
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={styles.modalContent}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Expense</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.amountInputContainer}>
              <Text style={styles.currencySymbol}>₹</Text>
              <TextInput 
                style={styles.amountInput} 
                keyboardType="numeric" 
                placeholder="0" 
                value={amount} 
                onChangeText={setAmount} 
                autoFocus={true} 
                placeholderTextColor={COLORS.textLight} 
              />
            </View>

            <Text style={styles.inputLabel}>Category</Text>
            <View style={styles.chipContainer}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity 
                  key={cat.id} 
                  style={[styles.chip, category === cat.id && styles.chipActive, { borderColor: cat.color }]} 
                  onPress={() => setCategory(cat.id)}
                >
                  <Text style={[styles.chipText, category === cat.id && styles.chipTextActive]}>
                    {cat.icon} {cat.id}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>Payment Method</Text>
            <View style={styles.methodContainer}>
              <TouchableOpacity 
                style={[styles.methodBtn, method === 'UPI' && styles.methodBtnActive]} 
                onPress={() => setMethod('UPI')}
              >
                <Text style={[styles.methodBtnText, method === 'UPI' && styles.methodBtnTextActive]}>
                  📱 UPI
                </Text>
                <Text style={styles.methodBalText}>Bal: ₹{remainingUPI.toFixed(0)}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.methodBtn, method === 'Cash' && styles.methodBtnActive]} 
                onPress={() => setMethod('Cash')}
              >
                <Text style={[styles.methodBtnText, method === 'Cash' && styles.methodBtnTextActive]}>
                  💰 Cash
                </Text>
                <Text style={styles.methodBalText}>Bal: ₹{remainingCash.toFixed(0)}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Description (Optional)</Text>
            <TextInput 
              style={styles.textInput} 
              placeholder="What was this for?" 
              value={desc} 
              onChangeText={setDesc} 
              placeholderTextColor={COLORS.textLight} 
            />

            <TouchableOpacity style={styles.primaryButton} onPress={handleSave}>
              <Text style={styles.primaryButtonText}>SAVE EXPENSE</Text>
            </TouchableOpacity>
            
            <View style={{height: 40}}/>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ==========================================
// DASHBOARD SCREEN
// ==========================================
function DashboardScreen({ tripName, activeTripId, totalCapital, totalSpent, remainingBalance, remainingCash, remainingUPI, budget, budgetUsagePercent, onAddExpense }) {
  let warningMsg = null; 
  let warningColor = COLORS.warning;
  
  if (budget > 0) {
    if (budgetUsagePercent >= 90) { 
      warningMsg = `⚠️ CRITICAL: ${budgetUsagePercent.toFixed(1)}% of budget used!`; 
      warningColor = COLORS.danger; 
    } else if (budgetUsagePercent >= 75) { 
      warningMsg = `⚠️ Warning: ${budgetUsagePercent.toFixed(1)}% of budget used.`; 
    }
  }

  return (
    <ScrollView style={styles.screenScroll} showsVerticalScrollIndicator={false}>
      
      <View style={styles.inviteBanner}>
        <Text style={styles.inviteText}>
          Trip Code: <Text style={{fontWeight: 'bold', color: COLORS.primary}}>{activeTripId}</Text>
        </Text>
      </View>

      {warningMsg && (
        <View style={[styles.warningBanner, { backgroundColor: warningColor + '15', borderColor: warningColor }]}>
          <Text style={[styles.warningText, { color: warningColor }]}>{warningMsg}</Text>
        </View>
      )}

      <View style={styles.mainBalanceCard}>
        <Text style={styles.balanceLabel}>Remaining Balance</Text>
        <Text style={[styles.balanceAmount, { color: remainingBalance < 0 ? '#FDA4AF' : '#FFF' }]}>
          ₹{remainingBalance.toFixed(2)}
        </Text>
        
        <View style={styles.balanceRow}>
          <View>
            <Text style={styles.subBalanceLabel}>Capital</Text>
            <Text style={styles.subBalanceAmount}>₹{totalCapital.toFixed(0)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.subBalanceLabel}>Spent</Text>
            <Text style={[styles.subBalanceAmount, { color: '#FDA4AF' }]}>₹{totalSpent.toFixed(0)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.splitBalanceContainer}>
        <View style={[styles.splitCard, { marginRight: 8 }]}>
          <View style={styles.splitIconBox}>
            <Text>💰</Text>
          </View>
          <Text style={styles.splitLabel}>Cash</Text>
          <Text style={[styles.splitAmount, { color: remainingCash < 0 ? COLORS.danger : COLORS.textDark }]}>
            ₹{remainingCash.toFixed(0)}
          </Text>
        </View>
        
        <View style={[styles.splitCard, { marginLeft: 8 }]}>
          <View style={[styles.splitIconBox, {backgroundColor: '#DBEAFE'}]}>
            <Text>📱</Text>
          </View>
          <Text style={styles.splitLabel}>UPI</Text>
          <Text style={[styles.splitAmount, { color: remainingUPI < 0 ? COLORS.danger : COLORS.textDark }]}>
            ₹{remainingUPI.toFixed(0)}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Quick Add Expense</Text>
      
      <View style={styles.categoriesGrid}>
        {CATEGORIES.map(cat => (
          <TouchableOpacity 
            key={cat.id} 
            style={styles.categoryCard} 
            onPress={() => onAddExpense(cat.id)} 
            activeOpacity={0.7}
          >
            <View style={[styles.iconCircle, { backgroundColor: cat.color + '15' }]}>
              <Text style={styles.catIcon}>{cat.icon}</Text>
            </View>
            <Text style={styles.catName}>{cat.id}</Text>
          </TouchableOpacity>
        ))}
      </View>
      
      <View style={{ height: 100 }} /> 
    </ScrollView>
  );
}

// ==========================================
// TRIPMATES SCREEN
// ==========================================
function TripmatesScreen({ tripmates, tripName }) {
  if (tripmates.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyIcon}>👥</Text>
        <Text style={styles.subText}>You are the only one here!</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screenScroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>
        Friends in {tripName || 'this Trip'} ({tripmates.length})
      </Text>
      <Text style={[styles.subText, {marginBottom: 20}]}>
        Anyone running the app will sync automatically.
      </Text>
      
      {tripmates.map((mate, index) => {
        const colors = ['#F59E0B', '#3B82F6', '#8B5CF6', '#10B981', '#F43F5E', '#06B6D4'];
        const avatarColor = colors[index % colors.length];

        return (
          <View key={mate.id} style={styles.mateCard}>
            <View style={[styles.mateAvatar, { backgroundColor: avatarColor + '20' }]}>
              <Text style={[styles.mateAvatarText, { color: avatarColor }]}>
                {mate.name ? mate.name.charAt(0).toUpperCase() : '?'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.mateName}>{mate.name}</Text>
              <Text style={styles.mateJoined}>
                Joined {new Date(mate.joinedAt).toLocaleDateString()}
              </Text>
            </View>
          </View>
        );
      })}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ==========================================
// HISTORY SCREEN
// ==========================================
function HistoryScreen({ expenses }) {
  if (expenses.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyIcon}>📝</Text>
        <Text style={styles.subText}>No expenses recorded yet.</Text>
      </View>
    );
  }

  const grouped = expenses.reduce((acc, exp) => {
    const d = new Date(exp.date); 
    const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    
    if (!acc[dateStr]) {
      acc[dateStr] = { total: 0, items: [] };
    }
    
    acc[dateStr].items.push(exp); 
    acc[dateStr].total += parseFloat(exp.amount); 
    return acc;
  }, {});

  return (
    <ScrollView style={styles.screenScroll} showsVerticalScrollIndicator={false}>
      {Object.keys(grouped).map((dateStr, index) => (
        <View key={index} style={styles.dayGroup}>
          
          <View style={styles.dayHeader}>
            <Text style={styles.dayHeaderText}>{dateStr}</Text>
            <Text style={styles.dayHeaderTotal}>
              ₹{grouped[dateStr].total.toFixed(0)}
            </Text>
          </View>
          
          <View style={styles.timelineContainer}>
            {grouped[dateStr].items.map((exp, i) => {
              const catObj = CATEGORIES.find(c => c.id === exp.category) || CATEGORIES[3];
              const timeStr = new Date(exp.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              
              return (
                <View key={exp.id} style={styles.timelineItem}>
                  <View style={styles.timelineGraphic}>
                    <View style={[styles.timelineDot, { backgroundColor: catObj.color }]} />
                    {i !== grouped[dateStr].items.length - 1 && (
                      <View style={styles.timelineLine} />
                    )}
                  </View>
                  
                  <View style={styles.expenseCard}>
                    <View style={styles.expenseHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <Text style={styles.expenseIcon}>{catObj.icon}</Text>
                        <View style={{ marginLeft: 12, flex: 1 }}>
                          <Text style={styles.expenseTitle}>{exp.desc}</Text>
                          <Text style={styles.expenseTime}>{timeStr} • {exp.method}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.expenseAmount}>
                          ₹{parseFloat(exp.amount).toFixed(0)}
                        </Text>
                      </View>
                    </View>
                    
                    <Text style={[styles.addedByText, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border }]}>
                      Added by {exp.addedBy || 'Unknown'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ==========================================
// ANALYTICS SCREEN
// ==========================================
function AnalyticsScreen({ totalCapital, totalSpent, remainingBalance, remainingCash, remainingUPI, expenses, tripName }) {
  
  const catTotals = CATEGORIES.map(cat => {
    const total = expenses
      .filter(e => e.category === cat.id)
      .reduce((sum, e) => sum + parseFloat(e.amount), 0); 
    return { ...cat, total };
  }).sort((a, b) => b.total - a.total);
  
  const maxCatTotal = Math.max(...catTotals.map(c => c.total), 1);

  const handleExport = async () => {
    try {
      let report = `✈️ ${tripName ? tripName.toUpperCase() : 'TRIP'} EXPENSE REPORT\n------------------------\nCapital: ₹${totalCapital}\nSpent: ₹${totalSpent}\nRemaining: ₹${remainingBalance}\n\n`;
      
      catTotals.forEach(c => { 
        if (c.total > 0) {
          report += `${c.icon} ${c.id}: ₹${c.total}\n`; 
        }
      });
      
      await Share.share({ 
        message: report, 
        title: 'Trip Report' 
      });
    } catch (error) { 
      Alert.alert("Error", error.message); 
    }
  };

  return (
    <ScrollView style={styles.screenScroll} showsVerticalScrollIndicator={false}>
      
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Expense Distribution</Text>
        
        {totalSpent > 0 ? (
          <View style={styles.stackedBarContainer}>
            {catTotals.map(c => {
              const widthPct = (c.total / totalSpent) * 100; 
              if (widthPct === 0) return null;
              
              return (
                <View 
                  key={c.id} 
                  style={[styles.stackedBarSegment, { width: `${widthPct}%`, backgroundColor: c.color }]} 
                />
              );
            })}
          </View>
        ) : (
          <Text style={styles.subText}>No expenses yet.</Text>
        )}
        
        <View style={styles.legendContainer}>
          {catTotals.filter(c=>c.total>0).map(c => (
            <View key={c.id} style={styles.legendItem}>
              <View style={[styles.legendColor, { backgroundColor: c.color }]} />
              <Text style={styles.legendText}>
                {c.id} ({(c.total/totalSpent*100).toFixed(0)}%)
              </Text>
            </View>
          ))}
        </View>
      </View>
      
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Category Totals</Text>
        <View style={styles.barChartContainer}>
          {catTotals.map(c => (
            <View key={c.id} style={styles.barRow}>
              <View style={styles.barLabelContainer}>
                <Text style={styles.barLabel}>{c.icon} {c.id}</Text>
                <Text style={styles.barValue}>₹{c.total.toFixed(0)}</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${(c.total / maxCatTotal) * 100}%`, backgroundColor: c.color }]} />
              </View>
            </View>
          ))}
        </View>
      </View>
      
      <TouchableOpacity 
        style={styles.exportButton} 
        onPress={handleExport} 
        activeOpacity={0.8}
      >
        <Text style={styles.exportButtonText}>📄 EXPORT REPORT</Text>
      </TouchableOpacity>
      
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// Wrapper for SafeAreaProvider
export default function AppWrapper() { 
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  ); 
}

// ==========================================
// STYLES
// ==========================================
const styles = StyleSheet.create({
  safeArea: { 
    flex: 1, 
    backgroundColor: COLORS.primary 
  },
  centerContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: COLORS.background 
  },
  titleText: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: COLORS.primary 
  },
  subText: { 
    fontSize: 16, 
    color: COLORS.textLight, 
    textAlign: 'center' 
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    backgroundColor: COLORS.primary 
  },
  menuButton: { 
    padding: 8 
  },
  menuIcon: { 
    color: '#FFF', 
    fontSize: 26, 
    fontWeight: 'bold' 
  },
  headerTitle: { 
    color: '#FFF', 
    fontSize: 20, 
    fontWeight: '600', 
    letterSpacing: 0.5 
  },
  menuOverlay: { 
    position: 'absolute', 
    top: 0, 
    left: 0, 
    right: 0, 
    bottom: 0, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    zIndex: 10 
  },
  drawer: { 
    position: 'absolute', 
    top: 0, 
    bottom: 0, 
    left: 0, 
    width: width * 0.8, 
    backgroundColor: '#FFF', 
    zIndex: 20, 
    elevation: 20, 
    shadowColor: '#000', 
    shadowOpacity: 0.3, 
    shadowRadius: 10 
  },
  drawerHeader: { 
    padding: 24, 
    backgroundColor: COLORS.background, 
    borderBottomWidth: 1, 
    borderBottomColor: COLORS.border, 
    marginBottom: 10 
  },
  drawerTitle: { 
    color: COLORS.primary, 
    fontSize: 24, 
    fontWeight: 'bold' 
  },
  drawerSub: { 
    color: COLORS.accent, 
    fontSize: 14, 
    marginTop: 4, 
    fontWeight: '600' 
  },
  drawerItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 16, 
    paddingHorizontal: 24, 
    borderRadius: 8, 
    marginHorizontal: 8 
  },
  drawerItemActive: { 
    backgroundColor: COLORS.primary + '10' 
  },
  drawerItemIcon: { 
    fontSize: 20, 
    marginRight: 16, 
    width: 24, 
    textAlign: 'center' 
  },
  drawerItemText: { 
    fontSize: 16, 
    color: COLORS.textDark, 
    fontWeight: '500' 
  },
  drawerDivider: { 
    height: 1, 
    backgroundColor: COLORS.border, 
    marginVertical: 10, 
    marginHorizontal: 24 
  },
  multiTripSection: { 
    backgroundColor: '#F8FAFC', 
    paddingVertical: 16, 
    borderTopWidth: 1, 
    borderBottomWidth: 1, 
    borderColor: COLORS.border, 
    marginVertical: 10 
  },
  multiTripTitle: { 
    fontSize: 12, 
    fontWeight: 'bold', 
    color: COLORS.textLight, 
    marginLeft: 24, 
    marginBottom: 8, 
    letterSpacing: 1 
  },
  tripSelectItem: { 
    paddingVertical: 12, 
    paddingHorizontal: 24, 
    marginHorizontal: 8, 
    borderRadius: 8 
  },
  tripSelectItemActive: { 
    backgroundColor: '#DBEAFE' 
  },
  tripSelectText: { 
    fontSize: 15, 
    color: COLORS.textDark 
  },
  newTripBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 12, 
    paddingHorizontal: 24, 
    marginTop: 8 
  },
  newTripBtnText: { 
    color: COLORS.primary, 
    fontWeight: 'bold', 
    fontSize: 15 
  },
  inviteBanner: { 
    backgroundColor: '#DBEAFE', 
    padding: 12, 
    borderRadius: 12, 
    marginBottom: 16, 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#BFDBFE' 
  },
  inviteText: { 
    color: '#1E3A8A', 
    fontSize: 14 
  },
  setupContainer: { 
    flex: 1, 
    backgroundColor: COLORS.background 
  },
  setupScroll: { 
    padding: 24, 
    flexGrow: 1, 
    justifyContent: 'center' 
  },
  setupHeader: { 
    marginBottom: 30 
  },
  setupTitle: { 
    fontSize: 24, 
    color: COLORS.textDark 
  },
  setupBrand: { 
    fontSize: 36, 
    fontWeight: '900', 
    color: COLORS.primary, 
    marginBottom: 8, 
    letterSpacing: -0.5 
  },
  card: { 
    backgroundColor: COLORS.card, 
    borderRadius: 20, 
    padding: 20, 
    marginBottom: 20, 
    elevation: 4, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 12 
  },
  inputLabel: { 
    fontSize: 14, 
    color: COLORS.textDark, 
    marginBottom: 8, 
    fontWeight: '600', 
    marginTop: 12 
  },
  input: { 
    borderWidth: 1, 
    borderColor: COLORS.border, 
    borderRadius: 12, 
    padding: 14, 
    fontSize: 16, 
    backgroundColor: '#F8FAFC', 
    color: COLORS.textDark 
  },
  summaryBox: { 
    backgroundColor: COLORS.primary, 
    padding: 20, 
    borderRadius: 16, 
    alignItems: 'center', 
    marginBottom: 30, 
    elevation: 4 
  },
  summaryLabel: { 
    color: '#94A3B8', 
    fontSize: 14, 
    textTransform: 'uppercase', 
    letterSpacing: 1, 
    marginBottom: 4 
  },
  summaryText: { 
    fontSize: 28, 
    fontWeight: 'bold', 
    color: '#FFF' 
  },
  primaryButton: { 
    backgroundColor: COLORS.accent, 
    paddingVertical: 18, 
    borderRadius: 16, 
    alignItems: 'center', 
    elevation: 4, 
    shadowColor: COLORS.accent, 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.3, 
    shadowRadius: 8 
  },
  primaryButtonText: { 
    color: '#FFF', 
    fontSize: 16, 
    fontWeight: 'bold', 
    letterSpacing: 1 
  },
  mainContainer: { 
    flex: 1, 
    backgroundColor: COLORS.background 
  },
  screenScroll: { 
    padding: 16 
  },
  mainBalanceCard: { 
    backgroundColor: COLORS.primary, 
    borderRadius: 24, 
    padding: 24, 
    marginBottom: 16, 
    elevation: 8, 
    shadowColor: COLORS.primary, 
    shadowOffset: { width: 0, height: 6 }, 
    shadowOpacity: 0.4, 
    shadowRadius: 12 
  },
  balanceLabel: { 
    color: '#94A3B8', 
    fontSize: 13, 
    fontWeight: '600', 
    textTransform: 'uppercase', 
    letterSpacing: 1 
  },
  balanceAmount: { 
    fontSize: 42, 
    fontWeight: 'bold', 
    marginVertical: 8, 
    letterSpacing: -1 
  },
  balanceRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginTop: 16, 
    paddingTop: 16, 
    borderTopWidth: 1, 
    borderTopColor: 'rgba(255,255,255,0.1)' 
  },
  subBalanceLabel: { 
    color: '#94A3B8', 
    fontSize: 12, 
    marginBottom: 4 
  },
  subBalanceAmount: { 
    color: '#FFF', 
    fontSize: 18, 
    fontWeight: 'bold' 
  },
  splitBalanceContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginBottom: 24 
  },
  splitCard: { 
    flex: 1, 
    backgroundColor: COLORS.card, 
    borderRadius: 20, 
    padding: 16, 
    elevation: 2, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 8 
  },
  splitIconBox: { 
    width: 36, 
    height: 36, 
    borderRadius: 18, 
    backgroundColor: '#FEF3C7', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 12 
  },
  splitLabel: { 
    fontSize: 13, 
    color: COLORS.textLight, 
    fontWeight: '500', 
    marginBottom: 4 
  },
  splitAmount: { 
    fontSize: 22, 
    fontWeight: 'bold' 
  },
  calendarStripContainer: { 
    backgroundColor: COLORS.card, 
    paddingVertical: 12, 
    borderBottomWidth: 1, 
    borderBottomColor: COLORS.border, 
    elevation: 2 
  },
  calendarDayCard: { 
    alignItems: 'center', 
    justifyContent: 'center', 
    paddingVertical: 10, 
    paddingHorizontal: 16, 
    borderRadius: 16, 
    marginRight: 8, 
    backgroundColor: COLORS.background, 
    borderWidth: 1, 
    borderColor: COLORS.border 
  },
  calendarDayCardActive: { 
    backgroundColor: COLORS.primary, 
    borderColor: COLORS.primary 
  },
  calMonthText: { 
    fontSize: 11, 
    color: COLORS.textLight, 
    marginBottom: 2, 
    textTransform: 'uppercase', 
    fontWeight: 'bold' 
  },
  calDayText: { 
    fontSize: 12, 
    color: COLORS.textLight, 
    marginTop: 2, 
    fontWeight: '600' 
  },
  calNumText: { 
    fontSize: 20, 
    color: COLORS.textDark, 
    fontWeight: 'bold' 
  },
  calTextActive: { 
    color: '#FFF' 
  },
  itineraryHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  emptyItinerary: { 
    alignItems: 'center', 
    justifyContent: 'center', 
    padding: 40, 
    backgroundColor: COLORS.card, 
    borderRadius: 20, 
    borderStyle: 'dashed', 
    borderWidth: 1, 
    borderColor: COLORS.border 
  },
  itineraryCard: { 
    flex: 1, 
    backgroundColor: COLORS.card, 
    borderRadius: 16, 
    padding: 16, 
    elevation: 1, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 4, 
    borderWidth: 1, 
    borderColor: COLORS.border, 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  itineraryTime: { 
    fontSize: 13, 
    color: COLORS.accent, 
    fontWeight: 'bold', 
    marginBottom: 4 
  },
  itineraryTitle: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: COLORS.textDark, 
    marginBottom: 2 
  },
  itineraryDesc: { 
    fontSize: 14, 
    color: COLORS.textLight 
  },
  mateCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: COLORS.card, 
    padding: 16, 
    borderRadius: 16, 
    marginBottom: 12, 
    elevation: 1, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 4, 
    borderWidth: 1, 
    borderColor: COLORS.border 
  },
  mateAvatar: { 
    width: 48, 
    height: 48, 
    borderRadius: 24, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 16 
  },
  mateAvatarText: { 
    fontSize: 20, 
    fontWeight: 'bold' 
  },
  mateName: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: COLORS.textDark 
  },
  mateJoined: { 
    fontSize: 13, 
    color: COLORS.textLight, 
    marginTop: 4 
  },
  addedByText: { 
    fontSize: 11, 
    color: COLORS.textLight, 
    fontStyle: 'italic', 
    marginTop: 4 
  },
  sysMsgContainer: { 
    alignItems: 'center', 
    marginVertical: 12 
  },
  sysMsgText: { 
    backgroundColor: COLORS.border, 
    color: COLORS.textDark, 
    paddingHorizontal: 12, 
    paddingVertical: 4, 
    borderRadius: 12, 
    fontSize: 12, 
    overflow: 'hidden' 
  },
  msgWrapper: { 
    marginBottom: 16, 
    maxWidth: '85%' 
  },
  msgWrapperMe: { 
    alignSelf: 'flex-end' 
  },
  msgWrapperOther: { 
    alignSelf: 'flex-start' 
  },
  msgSenderName: { 
    fontSize: 12, 
    color: COLORS.textLight, 
    marginBottom: 4, 
    marginLeft: 4 
  },
  msgBubble: { 
    padding: 12, 
    borderRadius: 16, 
    elevation: 1, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.1, 
    shadowRadius: 2 
  },
  msgBubbleMe: { 
    backgroundColor: COLORS.primaryLight, 
    borderBottomRightRadius: 4 
  },
  msgBubbleOther: { 
    backgroundColor: COLORS.card, 
    borderWidth: 1, 
    borderColor: COLORS.border, 
    borderBottomLeftRadius: 4 
  },
  msgText: { 
    fontSize: 15, 
    lineHeight: 20 
  },
  msgTextMe: { 
    color: '#FFF' 
  },
  msgTextOther: { 
    color: COLORS.textDark 
  },
  msgTime: { 
    fontSize: 10, 
    color: COLORS.textLight, 
    marginTop: 4, 
    alignSelf: 'flex-end', 
    marginRight: 4 
  },
  chatInputContainer: { 
    flexDirection: 'row', 
    padding: 12, 
    backgroundColor: COLORS.card, 
    borderTopWidth: 1, 
    borderTopColor: COLORS.border, 
    alignItems: 'flex-end' 
  },
  chatInput: { 
    flex: 1, 
    backgroundColor: COLORS.background, 
    borderRadius: 20, 
    paddingHorizontal: 16, 
    paddingTop: 12, 
    paddingBottom: 12, 
    fontSize: 15, 
    maxHeight: 100, 
    color: COLORS.textDark 
  },
  chatSendBtn: { 
    marginLeft: 12, 
    backgroundColor: COLORS.accent, 
    borderRadius: 20, 
    paddingVertical: 12, 
    paddingHorizontal: 20, 
    justifyContent: 'center' 
  },
  chatSendText: { 
    color: '#FFF', 
    fontWeight: 'bold', 
    fontSize: 15 
  },
  packInputContainer: { 
    flexDirection: 'row', 
    padding: 16, 
    backgroundColor: COLORS.card, 
    borderBottomWidth: 1, 
    borderBottomColor: COLORS.border, 
    alignItems: 'center' 
  },
  packInput: { 
    flex: 1, 
    backgroundColor: COLORS.background, 
    borderRadius: 12, 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    fontSize: 15, 
    color: COLORS.textDark 
  },
  packAddBtn: { 
    marginLeft: 12, 
    backgroundColor: COLORS.primary, 
    borderRadius: 12, 
    paddingVertical: 12, 
    paddingHorizontal: 20 
  },
  packAddText: { 
    color: '#FFF', 
    fontWeight: 'bold' 
  },
  packItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: COLORS.card, 
    padding: 16, 
    borderRadius: 12, 
    marginBottom: 12, 
    borderWidth: 1, 
    borderColor: COLORS.border 
  },
  packItemMine: { 
    borderColor: COLORS.primaryLight, 
    backgroundColor: '#F0F9FF' 
  },
  packItemPacked: { 
    opacity: 0.6 
  },
  packCheckbox: { 
    width: 28, 
    height: 28, 
    borderRadius: 14, 
    borderWidth: 2, 
    borderColor: COLORS.primaryLight, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: COLORS.card 
  },
  packName: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: COLORS.textDark 
  },
  packNamePacked: { 
    textDecorationLine: 'line-through', 
    color: COLORS.textLight 
  },
  packSub: { 
    fontSize: 12, 
    color: COLORS.textLight, 
    marginTop: 2 
  },
  sectionTitle: { 
    fontSize: 18, 
    fontWeight: '800', 
    color: COLORS.textDark, 
    marginBottom: 16, 
    letterSpacing: 0.5 
  },
  categoriesGrid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    justifyContent: 'space-between' 
  },
  categoryCard: { 
    width: '48%', 
    backgroundColor: COLORS.card, 
    borderRadius: 20, 
    padding: 20, 
    alignItems: 'center', 
    marginBottom: 16, 
    elevation: 2, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 8, 
    borderWidth: 1, 
    borderColor: COLORS.background 
  },
  iconCircle: { 
    width: 64, 
    height: 64, 
    borderRadius: 32, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 12 
  },
  catIcon: { 
    fontSize: 32 
  },
  catName: { 
    fontSize: 15, 
    fontWeight: '700', 
    color: COLORS.textDark 
  },
  fab: { 
    position: 'absolute', 
    bottom: 30, 
    right: 24, 
    width: 64, 
    height: 64, 
    borderRadius: 32, 
    backgroundColor: COLORS.accent, 
    justifyContent: 'center', 
    alignItems: 'center', 
    elevation: 8, 
    shadowColor: COLORS.accent, 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.4, 
    shadowRadius: 8 
  },
  fabText: { 
    fontSize: 32, 
    color: '#FFF', 
    fontWeight: '300', 
    marginTop: -2 
  },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(15, 23, 42, 0.6)', 
    justifyContent: 'flex-end' 
  },
  modalContent: { 
    backgroundColor: '#FFF', 
    borderTopLeftRadius: 32, 
    borderTopRightRadius: 32, 
    padding: 24, 
    maxHeight: '95%' 
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 24 
  },
  modalTitle: { 
    fontSize: 22, 
    fontWeight: 'bold', 
    color: COLORS.textDark 
  },
  closeBtn: { 
    fontSize: 24, 
    color: COLORS.textLight, 
    padding: 4 
  },
  amountInputContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    marginVertical: 20, 
    paddingBottom: 16, 
    borderBottomWidth: 1, 
    borderBottomColor: COLORS.border 
  },
  currencySymbol: { 
    fontSize: 42, 
    fontWeight: 'bold', 
    color: COLORS.primary, 
    marginRight: 8 
  },
  amountInput: { 
    fontSize: 56, 
    fontWeight: 'bold', 
    color: COLORS.textDark, 
    minWidth: 120, 
    textAlign: 'center' 
  },
  chipContainer: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    marginTop: 8, 
    marginBottom: 20 
  },
  chip: { 
    borderWidth: 1.5, 
    borderRadius: 24, 
    paddingVertical: 10, 
    paddingHorizontal: 16, 
    marginRight: 10, 
    marginBottom: 10, 
    backgroundColor: '#FFF' 
  },
  chipActive: { 
    backgroundColor: COLORS.primary, 
    borderColor: COLORS.primary 
  },
  chipText: { 
    fontSize: 14, 
    fontWeight: '600', 
    color: COLORS.textDark 
  },
  chipTextActive: { 
    color: '#FFF' 
  },
  methodContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginTop: 8, 
    marginBottom: 24 
  },
  methodBtn: { 
    flex: 1, 
    borderWidth: 1.5, 
    borderColor: COLORS.border, 
    borderRadius: 16, 
    padding: 16, 
    alignItems: 'center', 
    marginHorizontal: 4, 
    backgroundColor: '#FFF' 
  },
  methodBtnActive: { 
    borderColor: COLORS.accent, 
    backgroundColor: COLORS.accent + '10' 
  },
  methodBtnText: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: COLORS.textLight, 
    marginBottom: 4 
  },
  methodBtnTextActive: { 
    color: COLORS.accent 
  },
  methodBalText: { 
    fontSize: 12, 
    color: COLORS.textLight 
  },
  textInput: { 
    borderWidth: 1, 
    borderColor: COLORS.border, 
    borderRadius: 12, 
    padding: 16, 
    fontSize: 16, 
    color: COLORS.textDark, 
    backgroundColor: COLORS.background, 
    marginTop: 8, 
    marginBottom: 24 
  },
  emptyIcon: { 
    fontSize: 64, 
    marginBottom: 16 
  },
  dayGroup: { 
    marginBottom: 24 
  },
  dayHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    backgroundColor: COLORS.border, 
    paddingVertical: 8, 
    paddingHorizontal: 16, 
    borderRadius: 12, 
    marginBottom: 16 
  },
  dayHeaderText: { 
    fontSize: 13, 
    fontWeight: 'bold', 
    color: COLORS.textDark, 
    textTransform: 'uppercase', 
    letterSpacing: 1 
  },
  dayHeaderTotal: { 
    fontSize: 14, 
    fontWeight: 'bold', 
    color: COLORS.primary 
  },
  timelineContainer: { 
    paddingLeft: 8 
  },
  timelineItem: { 
    flexDirection: 'row', 
    marginBottom: 16 
  },
  timelineGraphic: { 
    alignItems: 'center', 
    marginRight: 16, 
    width: 20 
  },
  timelineDot: { 
    width: 16, 
    height: 16, 
    borderRadius: 8, 
    zIndex: 2, 
    borderWidth: 3, 
    borderColor: COLORS.background 
  },
  timelineLine: { 
    width: 2, 
    flex: 1, 
    backgroundColor: COLORS.border, 
    marginTop: -4, 
    marginBottom: -16, 
    zIndex: 1 
  },
  expenseCard: { 
    flex: 1, 
    backgroundColor: COLORS.card, 
    borderRadius: 16, 
    padding: 16, 
    elevation: 1, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 4, 
    borderWidth: 1, 
    borderColor: COLORS.border 
  },
  expenseHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  expenseIcon: { 
    fontSize: 28 
  },
  expenseTitle: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: COLORS.textDark 
  },
  expenseTime: { 
    fontSize: 12, 
    color: COLORS.textLight, 
    marginTop: 4 
  },
  expenseAmount: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: COLORS.textDark 
  },
  cardTitle: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: COLORS.textDark, 
    marginBottom: 16 
  },
  stackedBarContainer: { 
    flexDirection: 'row', 
    height: 24, 
    borderRadius: 12, 
    overflow: 'hidden', 
    marginBottom: 16 
  },
  stackedBarSegment: { 
    height: '100%' 
  },
  legendContainer: { 
    flexDirection: 'row', 
    flexWrap: 'wrap' 
  },
  legendItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    width: '50%', 
    marginBottom: 12 
  },
  legendColor: { 
    width: 14, 
    height: 14, 
    borderRadius: 7, 
    marginRight: 8 
  },
  legendText: { 
    fontSize: 13, 
    color: COLORS.textDark, 
    fontWeight: '500' 
  },
  barChartContainer: { 
    marginTop: 8 
  },
  barRow: { 
    marginBottom: 16 
  },
  barLabelContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginBottom: 8 
  },
  barLabel: { 
    fontSize: 14, 
    color: COLORS.textDark, 
    fontWeight: '600' 
  },
  barValue: { 
    fontSize: 14, 
    color: COLORS.textDark, 
    fontWeight: 'bold' 
  },
  barTrack: { 
    height: 12, 
    backgroundColor: COLORS.border, 
    borderRadius: 6, 
    overflow: 'hidden' 
  },
  barFill: { 
    height: '100%', 
    borderRadius: 6 
  },
  exportButton: { 
    backgroundColor: COLORS.primary, 
    paddingVertical: 18, 
    borderRadius: 16, 
    alignItems: 'center', 
    marginTop: 10, 
    elevation: 3 
  },
  exportButtonText: { 
    color: '#FFF', 
    fontSize: 15, 
    fontWeight: 'bold', 
    letterSpacing: 1 
  },
  warningBanner: { 
    padding: 12, 
    borderRadius: 12, 
    borderWidth: 1, 
    marginBottom: 16 
  },
  warningText: { 
    fontWeight: 'bold', 
    textAlign: 'center' 
  },
});