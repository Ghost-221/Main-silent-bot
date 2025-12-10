import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, runTransaction, off, query, orderByChild, equalTo, onChildChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

// Prevent user script on admin page
if (window.location.pathname.includes('admin.html')) {
    throw new Error("User script halted on Admin Page.");
}

const firebaseConfig = { apiKey: "AIzaSyB85E2DgcncPuUdY2TsiuULsXQJnzSo918", authDomain: "info-website-cb-24.firebaseapp.com", databaseURL: "https://info-website-cb-24-default-rtdb.firebaseio.com", projectId: "info-website-cb-24", storageBucket: "info-website-cb-24.firebasestorage.app", messagingSenderId: "625209481840", appId: "1:625209481840:web:534708ecc93ec66223b2b5" };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let user = null, userData = null;
let curSvcKey = "", curBasePrice = 0, curFinalPrice = 0;
let globalServices = {}, globalForms = {}, globalCategories = {}; 
let fakeSettings = { base: 0, auto: false }, realOrderCount = 0;
let activeChat = null, chatTimerInterval = null, maintInterval = null, orderStatusListener = null;
let activeCategory = "All";
let globalNoticeData = null; // New variable to store notice data temporarily

// --- THEME ---
window.toggleTheme = () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
};
if(localStorage.getItem('theme') === 'dark') document.body.setAttribute('data-theme', 'dark');

// --- ALERTS ---
window.showPremiumAlert = (title, msg, isError = false) => {
    let container = document.getElementById('toast-container');
    if(!container) { 
        container = document.createElement('div'); container.id = 'toast-container'; container.className = 'toast-container'; document.body.appendChild(container); 
    }
    const toast = document.createElement('div'); toast.className = `premium-toast ${isError ? 'error' : 'success'}`;
    const icon = isError ? '<i class="fas fa-times-circle"></i>' : '<i class="fas fa-check-circle"></i>';
    toast.innerHTML = `<div class="p-toast-icon">${icon}</div><div class="p-toast-content"><h4>${title}</h4><p>${msg}</p></div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.transition = "all 0.5s ease"; toast.style.opacity = '0'; toast.style.transform = 'translateY(-20px)'; setTimeout(() => toast.remove(), 500); }, 3500);
};

// --- COPY UTILITY ---
window.copyText = (text) => {
    navigator.clipboard.writeText(text).then(() => {
        window.showPremiumAlert("Copied! 📋", "Text copied to clipboard.");
    }).catch(err => {
        console.error("Failed to copy", err);
    });
};

// --- DATA LOAD ---
onValue(ref(db, 'settings'), (s) => {
    const data = s.val() || {};
    globalCategories = data.categories || {};
    globalServices = data.services_list || {};
    globalForms = data.service_forms || {};
    
    // Only render if elements exist (Handles Services Page vs Home Page)
    if(document.getElementById('category-bar')) renderCategories();
    if(document.getElementById('dynamic-services-grid')) renderServiceGrid();

    if(data.fake_counter) { fakeSettings = data.fake_counter; updateTotalDisplay(); }

    const marqueeBar = document.getElementById('marquee-bar');
    if(marqueeBar) {
        if(data.announcement) { marqueeBar.style.display = 'block'; document.getElementById('marquee-text').innerText = data.announcement; }
        else marqueeBar.style.display = 'none';
    }

    // --- FIX: Save notice data but DO NOT show immediately ---
    if(data.popup_notice) {
        globalNoticeData = data.popup_notice;
        attemptShowNotice(); // Try to show, but function will check auth status
    }
    // ---------------------------------------------------------

    const overlay = document.getElementById('system-overlay');
    const container = document.querySelector('.app-container');
    if(maintInterval) clearInterval(maintInterval);
    
    // Check Status Logic
    if (!data.system_status || data.system_status === 'active') {
        if(overlay) overlay.style.display = 'none';
        if(container) container.style.filter = 'none';
    } else {
        if(container) container.style.filter = 'blur(8px)';
        if(overlay) {
            overlay.style.display = 'flex';
            const icon = document.getElementById('sys-icon'), title = document.getElementById('sys-title'), desc = document.getElementById('sys-desc'), cd = document.getElementById('sys-countdown');
            
            // Reset contents
            if(cd) cd.style.display = 'none';
            if(desc) desc.innerHTML = "";

            if (data.system_status === 'off') {
                if(icon) icon.innerHTML = '<i class="fas fa-power-off" style="color:#ef4444;"></i>'; 
                if(title) title.innerText = "System Offline"; 
                const defMsg = "বর্তমানে আমাদের সিস্টেমে নিরাপত্তা আপডেটের কাজ চলমান রয়েছে। অনুগ্রহ করে আমাদের সাথে থাকুন ও ধৈর্য ধারণ করুন।\n\nকাজ সম্পন্ন হলে সিস্টেম স্বয়ংক্রিয়ভাবে স্বাভাবিক অবস্থায় ফিরে আসবে, ইনশা আল্লাহ।\n\nআপনাদের সহযোগিতার জন্য ধন্যবাদ।";
                if(desc) desc.innerText = data.off_message || defMsg; 
                desc.style.whiteSpace = "pre-line";
            } 
            else if (data.system_status === 'maintenance') {
                if(icon) icon.innerHTML = '<i class="fas fa-tools pulse-anim" style="color:#f59e0b;"></i>'; 
                if(title) title.innerText = "System Maintenance";
                
                if (data.maint_message && desc) {
                   desc.innerHTML = `<b style="color:#fbbf24; white-space: pre-line;">${data.maint_message}</b>`;
                } else if(desc) {
                   desc.innerHTML = "We are updating our servers.";
                }

                if (data.maint_end_ts) {
                    if(cd) {
                        cd.style.display = 'flex';
                        const runTimer = () => { 
                            const diff = (data.maint_end_ts || Date.now()) - Date.now(); 
                            if (diff <= 0) cd.innerHTML = "Finishing..."; 
                            else { 
                                const h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000), sec = Math.floor((diff % 60000) / 1000); 
                                cd.innerHTML = `${h}:${m}:${sec}`; 
                            } 
                        };
                        runTimer(); maintInterval = setInterval(runTimer, 1000);
                    }
                }
            }
        }
    }
});

// --- NEW FUNCTION: Only show notice if user is fully approved ---
function attemptShowNotice() {
    // 1. Must be logged in and user data loaded
    if(!user || !userData) return; 

    // 2. Must NOT be pending, rejected or banned
    if(userData.status === 'pending' || userData.status === 'rejected' || userData.status === 'banned') return;

    // 3. Optional: Check if already seen in this session (uncomment if needed)
    // if(sessionStorage.getItem('noticeSeen') === 'true') return;

    const popup = document.getElementById('notice-modal');
    if(popup && globalNoticeData && globalNoticeData.active === true && globalNoticeData.text) {
        document.getElementById('notice-text').innerText = globalNoticeData.text;
        popup.style.display = 'flex';
    }
}

window.closeNotice = () => { 
    document.getElementById('notice-modal').style.display = 'none'; 
    sessionStorage.setItem('noticeSeen', 'true'); // Mark as seen for this session
};

// --- GLOBAL ALERT FIX (LISTENER) ---
onValue(ref(db, 'settings/global_alert'), (s) => {
    const d = s.val();
    if (d && d.active && d.message) {
        const lastSeen = sessionStorage.getItem('last_alert_ts');
        if(String(d.timestamp) !== lastSeen) {
            window.showPremiumAlert("📢 Announcement", d.message);
            sessionStorage.setItem('last_alert_ts', d.timestamp);
        }
    }
});

onValue(ref(db, 'orders'), (s) => { let count = 0; s.forEach(() => { count++; }); realOrderCount = count; updateTotalDisplay(); });
function updateTotalDisplay() {
    const el = document.getElementById('fake-total-orders'); if(!el) return;
    let total = realOrderCount + (parseInt(fakeSettings.base) || 0);
    if(fakeSettings.auto && fakeSettings.start_ts) { const now = Date.now(); const mins = (now - fakeSettings.start_ts) / (1000 * 60); total += Math.floor(mins); }
    el.innerText = total.toLocaleString();
}
setInterval(updateTotalDisplay, 30000);

const sysHTML = `<div id="system-overlay" class="system-overlay"><div class="sys-box"><div id="sys-icon" class="sys-icon"></div><h2 id="sys-title" class="sys-title"></h2><p id="sys-desc" class="sys-desc"></p><div id="sys-countdown" class="countdown-box" style="display:none;"></div></div></div>`;
document.body.insertAdjacentHTML('beforeend', sysHTML);

// --- AUTH LOGIC ---
onAuthStateChanged(auth, u => {
    const loader = document.getElementById('startup-loader');
    const navBar = document.querySelector('.bottom-nav');

    if (!u && window.location.pathname.includes('services.html')) {
        window.location.href = 'index.html';
        return;
    }

    if (u) {
        user = u;
        onValue(ref(db, 'users/' + u.uid), s => {
            userData = s.val();
            if(!userData) { signOut(auth); return; }
            if(userData.role === 'admin') { signOut(auth); alert("Admin access denied here."); return; }

            startLiveNotifications(u.uid);
            
            // --- STATUS CHECKS (UPDATED) ---

            // 1. REJECTED CHECK
            if (userData.status === 'rejected') {
                if(loader) loader.style.display = 'none';
                
                // Hide main views
                if(document.getElementById('auth-view')) document.getElementById('auth-view').style.display = 'none';
                if(document.getElementById('main-view')) document.getElementById('main-view').style.display = 'none';
                if(document.getElementById('pending-view')) document.getElementById('pending-view').style.display = 'none';
                if(navBar) navBar.style.display = 'none';

                // Show Rejected View
                const rejView = document.getElementById('rejected-view');
                if(rejView) rejView.style.display = 'flex';
                else document.body.innerHTML = "<h2 style='text-align:center; color:red; margin-top:50px;'>Account Rejected</h2>";
                
                return; // Stop execution here
            }

            // 2. BANNED CHECK
            if(userData.status === 'banned') { 
                if(loader) loader.style.display = 'none';
                document.body.innerHTML = "<h1 style='color:red;text-align:center;margin-top:50px;'>ACCOUNT BANNED</h1>"; 
                return; 
            }

            // 3. PENDING CHECK
            if(userData.status === 'pending') { 
                if(loader) loader.style.display = 'none';
                if(document.getElementById('pending-view')) document.getElementById('pending-view').style.display = 'flex'; 
                if(document.getElementById('auth-view')) document.getElementById('auth-view').style.display='none'; 
                if(document.getElementById('main-view')) document.getElementById('main-view').style.display='none'; 
                if(navBar) navBar.style.display = 'none';
                return; 
            }
            
            // 4. ACTIVE (SUCCESS)
            if (loader) loader.style.display = 'none';
            updateUserDataUI();
            
            // --- FIX: Attempt to show notice now that user is approved ---
            attemptShowNotice(); 
            // -----------------------------------------------------------

            if(document.getElementById('auth-view')) document.getElementById('auth-view').style.display = 'none';
            if(document.getElementById('pending-view')) document.getElementById('pending-view').style.display = 'none';
            if(document.getElementById('rejected-view')) document.getElementById('rejected-view').style.display = 'none';
            
            if(navBar) navBar.style.display = 'flex';
            
            const urlParams = new URLSearchParams(window.location.search);
            const tab = urlParams.get('tab');
            
            if(tab === 'profile') {
                window.switchTab('profile', document.getElementById('nav-profile'));
            } else {
                if(document.getElementById('main-view')) document.getElementById('main-view').style.display = 'block';
            }

            loadHistory(); 
            loadProfile();
        });
    } else {
        if(loader) loader.style.display = 'none';
        if(document.getElementById('auth-view')) document.getElementById('auth-view').style.display = 'flex'; 
        if(document.getElementById('main-view')) document.getElementById('main-view').style.display = 'none'; 
        if(document.getElementById('profile-view')) document.getElementById('profile-view').style.display = 'none';
        if(document.getElementById('pending-view')) document.getElementById('pending-view').style.display = 'none';
        if(document.getElementById('rejected-view')) document.getElementById('rejected-view').style.display = 'none';
        if(navBar) navBar.style.display = 'none';
    }
});

function updateUserDataUI() {
    const badgeHTML = userData.isVerified ? ' <i class="fas fa-check-circle verified-badge"></i>' : '';

    if(document.getElementById('u-name')) {
        document.getElementById('u-name').innerHTML = userData.name + badgeHTML;
    }
    if(document.getElementById('card-holder-name')) {
        document.getElementById('card-holder-name').innerText = userData.name;
    }
    if(document.getElementById('p-name')) {
        document.getElementById('p-name').innerHTML = userData.name + badgeHTML;
    }
    
    if(document.getElementById('u-bal')) document.getElementById('u-bal').innerText = userData.balance || 0;
    if(document.getElementById('p-phone')) document.getElementById('p-phone').innerText = userData.phone;
}

window.switchTab = (tab, el) => { 
    const views = ['main-view', 'profile-view'];
    views.forEach(v => { const elem = document.getElementById(v); if(elem) elem.style.display = 'none'; });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); 
    if(el) el.classList.add('active'); 
    
    if(tab === 'home') {
        if(document.getElementById('main-view')) document.getElementById('main-view').style.display = 'block'; 
        if(window.location.pathname.includes('services.html')) window.location.href = 'index.html';
    } 
    else if(tab === 'profile') {
        if(document.getElementById('profile-view')) {
            document.getElementById('profile-view').style.display = 'block'; 
            loadProfile();
        } else {
            window.location.href = 'index.html?tab=profile';
        }
    }
};

window.toggleAuth = () => {
    const btnText = document.getElementById('auth-switch-text');
    const isLogin = document.getElementById('reg-fields').style.display === 'none';
    if (isLogin) { document.getElementById('reg-disclaimer-modal').style.display = 'block'; document.getElementById('auth-form-container').style.display = 'none'; } 
    else { document.getElementById('reg-fields').style.display = 'none'; document.getElementById('auth-btn').innerText = "LOGIN"; btnText.innerText = "Create New Account"; }
};
window.acceptDisclaimer = () => { document.getElementById('reg-disclaimer-modal').style.display = 'none'; document.getElementById('auth-form-container').style.display = 'block'; document.getElementById('reg-fields').style.display = 'block'; document.getElementById('auth-btn').innerText = "REGISTER"; document.getElementById('auth-switch-text').innerText = "Already have an account? Login"; };

// --- AUTH ACTION ---
window.authAction = async () => {
    const btn = document.getElementById('auth-btn'); const e = document.getElementById('email').value, p = document.getElementById('pass').value;
    const isReg = document.getElementById('reg-fields').style.display === 'block';
    if(!e || !p) return window.showPremiumAlert("Error", "Enter details", true);
    
    btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
    try {
        if(isReg) {
            const n = document.getElementById('r-name').value;
            const ph = document.getElementById('r-phone').value;
            const tg = document.getElementById('r-telegram').value; 

            if(!n || !ph || !tg) throw new Error("Name, Phone & Telegram required");
            
            const c = await createUserWithEmailAndPassword(auth, e, p);
            
            await set(ref(db, 'users/'+c.user.uid), { 
                name: n, 
                phone: ph, 
                telegram: tg, 
                email: e, 
                role: 'user', 
                status: 'pending', 
                balance: 0, 
                joined_at: Date.now() 
            });
            window.showPremiumAlert("Success", "Registered! Wait for approval.");
            setTimeout(() => window.location.reload(), 2000);
        } else {
            await signInWithEmailAndPassword(auth, e, p); 
        }
    } catch(err) { window.showPremiumAlert("Failed", err.message, true); } 
    finally { btn.innerHTML = isReg ? 'REGISTER' : 'LOGIN'; btn.disabled = false; }
};

window.logout = () => signOut(auth).then(() => window.location.href = 'index.html');

function loadHistory() { 
    onValue(ref(db, 'orders'), s => { 
        const list = document.getElementById('history-list'); 
        if(!list) return; 
        list.innerHTML = ""; 
        let t=0, c=0, x=0; 
        const allOrders = [];
        
        s.forEach(o => { 
            const v = o.val(); 
            if(v.userId === user.uid) { 
                v.key = o.key;
                allOrders.push(v);
                t++; 
                if(v.status==='completed') c++; 
                if(v.status==='cancelled') x++; 
            } 
        }); 

        allOrders.sort((a,b) => b.timestamp - a.timestamp);

        if(allOrders.length === 0) { list.innerHTML = '<p style="text-align:center; font-size:12px; color:var(--text-muted)">No orders yet.</p>'; }

        allOrders.forEach(v => {
            let isExpired = false;
            if(v.status === 'completed' && v.completed_at) { if((Date.now() - v.completed_at) > 86400000) isExpired = true; }
            let chatBtn = (!isExpired && v.status !== 'cancelled') ? `<button class="chat-btn-small" onclick="window.openChat('${v.key}', '${v.orderId_visible}')"><i class="fas fa-comments"></i></button>` : '';
            let clr = v.status==='completed'?'#10b981':(v.status==='cancelled'?'#ef4444':'#f59e0b'); 
            let noteHTML = (v.status === 'cancelled' && v.admin_note) ? `<div style="font-size:11px; color:#ef4444; background:#fef2f2; padding:5px; border-radius:4px; margin-top:5px;">Reason: ${v.admin_note}</div>` : ""; 
            list.innerHTML += `<div class="order-card"><div class="order-top"><b style="font-size:14px; color:var(--text);">${v.service}</b>${chatBtn}</div><div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-muted);"><span>#${v.orderId_visible}</span><span class="status-badge" style="color:${clr}; background:${clr}15;">${v.status.toUpperCase()}</span></div>${noteHTML}<div style="font-size:10px; color:var(--text-muted); text-align:right;">${new Date(v.timestamp).toLocaleDateString()}</div></div>`; 
        });
        
        if(document.getElementById('stat-total')) { 
            document.getElementById('stat-total').innerText = t; 
            document.getElementById('stat-comp').innerText = c; 
            document.getElementById('stat-cancel').innerText = x; 
        } 
    }); 
}

function loadProfile() { 
    onValue(ref(db, 'balance_requests'), s => { 
        const l = document.getElementById('deposit-list'); 
        if(!l) return; 
        l.innerHTML = ""; 
        let found = false;
        
        const reqs = [];
        s.forEach(r => { const d = r.val(); if(d.uid === user.uid) { d.key=r.key; reqs.push(d); found = true; } });
        reqs.sort((a,b) => b.timestamp - a.timestamp);

        reqs.forEach(d => {
            let clr = d.status==='approved'?'#10b981':(d.status==='rejected'?'#ef4444':'#f59e0b'); 
            let note = d.status==='rejected' ? `<div style="font-size:10px; color:#ef4444; margin-top:5px;">${d.reject_reason || 'Rejected'}</div>` : ''; 
            l.innerHTML += `<div class="hist-card" style="flex-direction:column; align-items:flex-start;"><div style="display:flex; justify-content:space-between; width:100%; align-items:center;"><div><div style="font-weight:600; font-size:13px; color:var(--text);">৳ ${d.amount}</div><div style="font-size:10px; color:var(--text-muted);">${d.trxId}</div></div><span class="status-badge" style="color:${clr}; background:${clr}15;">${d.status}</span></div>${note}</div>`;
        });

        if(!found) l.innerHTML = `<p style="text-align:center; color:var(--text-muted); font-size:12px;">No deposit history found.</p>`;
    }); 
}

function startLiveNotifications(uid) {
    const ordersRef = query(ref(db, 'orders'), orderByChild('userId'), equalTo(uid));
    onChildChanged(ordersRef, (snapshot) => {
        const data = snapshot.val(); if(!data) return;
        if (data.status === 'completed') window.showPremiumAlert('Order Completed! ✅', `Order #${data.orderId_visible || '..'} is successfully done.`, false);
        else if (data.status === 'cancelled') window.showPremiumAlert('Order Cancelled ❌', `Order #${data.orderId_visible || '..'} was cancelled.`, true);
    });
    const depositRef = query(ref(db, 'balance_requests'), orderByChild('uid'), equalTo(uid));
    onChildChanged(depositRef, (snapshot) => {
        const data = snapshot.val(); if(!data) return;
        if (data.status === 'approved') window.showPremiumAlert('Money Added! 💰', `৳${data.amount} has been added to your balance.`, false);
        else if (data.status === 'rejected') window.showPremiumAlert('Deposit Rejected ⚠️', `Request for ৳${data.amount} was rejected.`, true);
    });
}

window.openPayModal = () => { document.getElementById('pay-modal').style.display='flex'; document.getElementById('pay-step-1').style.display='block'; document.getElementById('pay-step-2').style.display='none'; }
window.closePayModal = () => document.getElementById('pay-modal').style.display='none';
window.nextPayStep = () => { document.getElementById('pay-step-1').style.display='none'; document.getElementById('pay-step-2').style.display='block'; };
window.submitDeposit = async () => {
    const n = document.getElementById('d-name').value, m = document.getElementById('d-mobile').value, a = document.getElementById('d-amt').value, t = document.getElementById('d-trx').value, i = document.getElementById('d-img').value;
    if(!n || !m || !a || !t || !i) return window.showPremiumAlert("Missing Info", "Please fill all fields.", true);
    if(Number(a) < 200) return window.showPremiumAlert("Invalid Amount", "Minimum deposit is 200 BDT.", true);
    await push(ref(db, 'balance_requests'), { uid: user.uid, uName: userData.name, accName: n, accMobile: m, amount: Number(a), trxId: t, screenshot: i, status: 'pending', timestamp: Date.now() });
    window.closePayModal(); window.showPremiumAlert("Submitted!", "Request sent for approval.");
};

function renderCategories() {
    const catBar = document.getElementById('category-bar');
    if(!catBar) return;
    catBar.innerHTML = `<div class="cat-chip ${activeCategory === "All" ? 'active' : ''}" onclick="window.filterServices('All', this)">All</div>`;
    Object.values(globalCategories).forEach(catName => {
        catBar.innerHTML += `<div class="cat-chip ${catName === activeCategory ? 'active' : ''}" onclick="window.filterServices('${catName}', this)">${catName}</div>`;
    });
}

function renderServiceGrid() {
    const grid = document.getElementById('dynamic-services-grid');
    if(!grid) return;
    grid.innerHTML = "";
    let hasService = false;
    Object.entries(globalServices).forEach(([key, svc]) => {
        const isCatMatch = activeCategory === "All" || (svc.category || "Others") === activeCategory;
        if (isCatMatch) {
            hasService = true;
            const isAvailable = svc.active !== false;
            const statusHTML = !isAvailable ? '<div class="svc-status-badge">Unavailable</div>' : '';
            const cardClass = isAvailable ? 'svc-card' : 'svc-card disabled';
            const clickAction = isAvailable ? `window.openOrder('${key}')` : '';
            const colors = ['#f59e0b', '#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#ef4444'];
            const rndColor = colors[key.length % colors.length];
            grid.innerHTML += `<div class="${cardClass}" onclick="${clickAction}">${statusHTML}<div class="svc-icon" style="background:${rndColor}"><i class="${svc.icon}"></i></div><b style="font-size:13px;">${svc.name}</b><br><span class="svc-price">৳ ${svc.price}</span></div>`;
        }
    });
    if(!hasService) grid.innerHTML = `<div style="grid-column: span 2; text-align: center; color:var(--text-muted); padding:20px;">No services found in this category.</div>`;
}

window.filterServices = (cat, el) => {
    activeCategory = cat;
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    renderServiceGrid();
};

window.openOrder = (key) => {
    const svc = globalServices[key]; if(!svc) return;
    curSvcKey = key; curBasePrice = parseInt(svc.price); curFinalPrice = curBasePrice; 
    document.getElementById('ord-title').innerText = svc.name;
    document.getElementById('ord-cost').innerText = curFinalPrice;
    
    const formContainer = document.getElementById('ord-dynamic-form');
    formContainer.innerHTML = "";
    const fields = globalForms[key] || [];

    if(fields.length === 0) {
        formContainer.innerHTML = `<div class="form-group"><label class="input-label">Details</label><textarea class="auth-inp dynamic-field" data-label="Details" rows="4"></textarea></div>`;
    } else {
        fields.forEach(f => {
            let html = "";
            const safeLabel = f.label.replace(/[^a-zA-Z0-9]/g, '_');
            
            if(f.type === 'textarea') {
                html = `<textarea class="auth-inp dynamic-field" data-label="${f.label}" rows="4" placeholder="${f.label}"></textarea>`;
            } 
            else if (f.type === 'link') {
                html = `<input class="auth-inp dynamic-field" type="url" data-label="${f.label}" placeholder="https://...">`;
            }
            else if (f.type === 'file_url') {
                html = `
                    <div style="background:var(--bg); padding:10px; border-radius:8px; border:1px solid var(--border);">
                        <label style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:5px;">${f.label} (Upload Image & Paste Link)</label>
                        <input class="auth-inp dynamic-field" data-label="${f.label}" style="margin:0;" placeholder="https://ibb.co/...">
                        <a href="https://imgbb.com" target="_blank" style="font-size:11px; color:var(--primary); display:block; text-align:right; margin-top:5px;"><i class="fas fa-cloud-upload-alt"></i> Upload Here</a>
                    </div>
                `;
            }
            else if(f.type === 'radio_grid') {
                const opts = f.options.split(',').map(s => s.trim());
                let boxes = "";
                opts.forEach(opt => {
                    const parts = opt.split('=');
                    const name = parts[0].trim();
                    let price = null;
                    if (parts.length > 1 && !isNaN(parseInt(parts[1].trim()))) { price = parseInt(parts[1].trim()); }
                    const priceAttr = price ? `data-price="${price}"` : '';
                    const priceDisplay = price ? `<span class="opt-price-tag">৳ ${price}</span>` : '';
                    boxes += `<div class="select-option" onclick="window.selectOption(this, '${safeLabel}')" ${priceAttr} data-val="${name}">${name}${priceDisplay}</div>`;
                });
                html = `<div class="select-box-grid" id="grp-${safeLabel}">${boxes}</div><input type="hidden" class="dynamic-field" data-label="${f.label}" id="input-${safeLabel}">`;
            } else {
                html = `<input class="auth-inp dynamic-field" type="${f.type}" data-label="${f.label}" placeholder="${f.label}">`;
            }
            
            if(f.type !== 'file_url') {
                formContainer.innerHTML += `<div class="form-group"><label class="input-label">${f.label}</label>${html}</div>`;
            } else {
                formContainer.innerHTML += html; 
            }
        });
    }
    document.getElementById('ord-modal').style.display = 'flex';
};

window.selectOption = (el, label) => {
    const grp = document.getElementById(`grp-${label}`);
    if (grp) {
        grp.querySelectorAll('.select-option').forEach(b => b.classList.remove('active'));
        el.classList.add('active');
        document.getElementById(`input-${label}`).value = el.getAttribute('data-val');
        const priceOverride = el.getAttribute('data-price');
        if(priceOverride) { curFinalPrice = parseInt(priceOverride); } else { curFinalPrice = curBasePrice; }
        document.getElementById('ord-cost').innerText = curFinalPrice;
    }
};

window.confirmOrder = () => {
    const inputs = document.querySelectorAll('.dynamic-field'); let details = "", empty = false;
    inputs.forEach(i => { const val = i.value; const lbl = i.getAttribute('data-label'); if(!val) empty = true; details += `${lbl}: ${val}\n`; });
    if(empty) return window.showPremiumAlert("Missing Info", "Please fill all fields.", true);
    
    runTransaction(ref(db, 'users/' + user.uid + '/balance'), (bal) => { 
        if (bal >= curFinalPrice) return bal - curFinalPrice; return; 
    }).then(async (res) => { 
        if(res.committed) { 
            const shortId = Math.floor(100000 + Math.random() * 900000).toString(); 
            const newOrderRef = push(ref(db, 'orders')); 
            
            // 1. Order Data
            await set(newOrderRef, { userId: user.uid, uName: userData.name, service: globalServices[curSvcKey].name, cost: curFinalPrice, details: details, file: "", status: 'pending', timestamp: Date.now(), orderId_visible: shortId }); 
            
            window.showPremiumAlert("Success", "Order Placed!"); 

            // 2. System Msg
            await push(ref(db, 'chats/'+newOrderRef.key), {s:'sys', t:`Order Placed. ID: ${shortId}`});
            
            // 3. AUTO REPLY
            const autoMsg = "আপনার অর্ডার অ্যাডমিন প্যানেলে সাবমিট হয়েছে। একজন অ্যাডমিন শীঘ্রই আপনার সাথে কথা বলবেন। ততক্ষণ চ্যাট বক্সে থাকুন। ধন্যবাদ।";
            await push(ref(db, 'chats/'+newOrderRef.key), {s:'admin', t: autoMsg});

            document.getElementById('ord-modal').style.display='none'; 
            window.openChat(newOrderRef.key, shortId); 
        } else { window.showPremiumAlert("Failed", "Insufficient Balance!", true); } 
    });
};

// --- CHAT SYSTEM ---
window.openChat = (k, id) => { 
    const chatModal = document.getElementById('chat-modal');
    if(!chatModal) return;
    
    activeChat = k; 
    chatModal.style.display='flex'; 
    if(document.getElementById('chat-head')) document.getElementById('chat-head').innerText = "Chat #" + id; 
    const inp = document.getElementById('chat-input-wrap'), cls = document.getElementById('chat-closed-wrap'); 

    if (orderStatusListener) off(orderStatusListener); 
    
    orderStatusListener = onValue(ref(db, 'orders/' + k), (s) => { 
        const data = s.val(); if(!data) return; const status = data.status; 
        
        if (status === 'cancelled') { window.closeChatModal(); return; } 
        if (chatTimerInterval) clearInterval(chatTimerInterval); 
        
        if (status === 'pending') { 
            inp.style.display = 'flex'; 
            cls.style.display = 'none'; 
        } 
        else if (status === 'processing') { 
            inp.style.display = 'none'; 
            cls.style.display = 'block'; 
            cls.className = 'chat-closed-ui processing'; 
            cls.innerHTML = '<i class="fas fa-lock"></i> অর্ডার প্রসেসিং এ আছে। চ্যাট বন্ধ।'; 
        } 
        else if (status === 'completed') { 
            inp.style.display = 'none'; 
            cls.style.display = 'block'; 
            cls.className = 'chat-closed-ui'; 
            const updateTimer = () => { const diff = 86400000 - (Date.now() - (data.completed_at || 0)); if (diff <= 0) { clearInterval(chatTimerInterval); chatModal.style.display='none'; } else { const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)); cls.innerHTML = `<i class="fas fa-history"></i> Chat expiring in: ${h}h`; } }; 
            updateTimer(); chatTimerInterval = setInterval(updateTimer, 60000);
        } 
    }); 

    onValue(ref(db, 'chats/'+k), s => { 
        const b = document.getElementById('chat-box'); b.innerHTML=""; 
        s.forEach(c => { 
            const m=c.val(); 
            // Copy Icon
            const copyIcon = `<i class="fas fa-copy copy-btn-icon" onclick="event.stopPropagation(); window.copyText('${m.t.replace(/'/g, "\\'")}')"></i>`;
            
            b.innerHTML += `<div class="msg-row ${m.s===user.uid?'me':'adm'}"><div class="msg ${m.s===user.uid?'msg-me':'msg-adm'}"><span>${m.t}</span>${copyIcon}</div></div>`; 
        }); 
        b.scrollTop = b.scrollHeight; 
    }); 
};

window.sendMsg = () => { const t = document.getElementById('chat-in').value; if(t && activeChat) { push(ref(db, 'chats/'+activeChat), {s:user.uid, t:t}); document.getElementById('chat-in').value=""; } };
window.closeChatModal = () => { document.getElementById('chat-modal').style.display='none'; if (chatTimerInterval) clearInterval(chatTimerInterval); if(orderStatusListener) off(orderStatusListener); };