import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, runTransaction, off, query, orderByChild, equalTo, onChildChanged, remove } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

// Prevent user script on admin page
if (window.location.pathname.includes('admin.html')) {
    throw new Error("User script halted on Admin Page.");
}

// --- SOUND EFFECTS ---
const sndMsg = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
const sndSuccess = new Audio('https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3');
const sndAlert = new Audio('https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3');

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
let globalNoticeData = null; 

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
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            window.showPremiumAlert("Copied! 📋", "Text copied to clipboard.");
        }).catch(err => fallbackCopyText(text));
    } else {
        fallbackCopyText(text);
    }
};

function fallbackCopyText(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed"; textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus(); textArea.select();
    try {
        const successful = document.execCommand('copy');
        if(successful) window.showPremiumAlert("Copied! 📋", "Text copied to clipboard.");
        else window.showPremiumAlert("Error", "Failed to copy text.", true);
    } catch (err) { window.showPremiumAlert("Error", "Failed to copy text.", true); }
    document.body.removeChild(textArea);
}

// --- TELEGRAM COMPATIBLE DOWNLOAD FUNCTION ---
window.downloadMedia = (base64Data, fileName) => {
    try {
        if (!base64Data || !base64Data.includes(',')) {
            window.showPremiumAlert("Error", "Invalid file data.", true);
            return;
        }

        const parts = base64Data.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) { u8arr[n] = bstr.charCodeAt(n); }

        const blob = new Blob([u8arr], { type: mime });
        const url = window.URL.createObjectURL(blob);

        // Telegram Strategy 1: Create link and force click
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = fileName || 'download';
        a.target = "_blank"; // Important for Telegram to handle it externally
        document.body.appendChild(a);
        
        a.click();
        
        // Telegram Strategy 2: If simple click fails, try window.open
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 1000);

    } catch (e) {
        window.showPremiumAlert("Download Failed", "Please use the 'View' button.", true);
    }
};

// --- NEW FUNCTION: VIEW IMAGE (For Telegram Long-Press Save) ---
window.viewImage = (base64Data) => {
    const win = window.open();
    if (win) {
        win.document.write(`<img src="${base64Data}" style="width:100%">`);
    } else {
        window.showPremiumAlert("Blocked", "Allow popups to view image.", true);
    }
};

// --- IMAGE COMPRESSION ---
const processFile = (file) => {
    return new Promise((resolve, reject) => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const MAX_WIDTH = 1024;
                    const MAX_HEIGHT = 1024;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                    } else {
                        if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.7)); 
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        } else {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        }
    });
};

// --- DATA LOAD ---
onValue(ref(db, 'settings'), (s) => {
    const data = s.val() || {};
    globalCategories = data.categories || {};
    globalServices = data.services_list || {};
    globalForms = data.service_forms || {};
    if(document.getElementById('category-bar')) renderCategories();
    if(document.getElementById('dynamic-services-grid')) renderServiceGrid();
    if(data.fake_counter) { fakeSettings = data.fake_counter; updateTotalDisplay(); }
    const marqueeBar = document.getElementById('marquee-bar');
    if(marqueeBar) {
        if(data.announcement) { marqueeBar.style.display = 'block'; document.getElementById('marquee-text').innerText = data.announcement; }
        else marqueeBar.style.display = 'none';
    }
    if(data.popup_notice) { globalNoticeData = data.popup_notice; attemptShowNotice(); }
    const overlay = document.getElementById('system-overlay');
    const container = document.querySelector('.app-container');
    if(maintInterval) clearInterval(maintInterval);
    if (!data.system_status || data.system_status === 'active') {
        if(overlay) overlay.style.display = 'none';
        if(container) container.style.filter = 'none';
    } else {
        if(container) container.style.filter = 'blur(8px)';
        if(overlay) {
            overlay.style.display = 'flex';
            const icon = document.getElementById('sys-icon'), title = document.getElementById('sys-title'), desc = document.getElementById('sys-desc'), cd = document.getElementById('sys-countdown');
            if(cd) cd.style.display = 'none';
            if(desc) desc.innerHTML = "";
            if (data.system_status === 'off') {
                if(icon) icon.innerHTML = '<i class="fas fa-power-off" style="color:#ef4444;"></i>'; 
                if(title) title.innerText = "System Offline"; 
                if(desc) desc.innerText = data.off_message || "সিস্টেম অফলাইন।"; 
                desc.style.whiteSpace = "pre-line";
            } else if (data.system_status === 'maintenance') {
                if(icon) icon.innerHTML = '<i class="fas fa-tools pulse-anim" style="color:#f59e0b;"></i>'; 
                if(title) title.innerText = "System Maintenance";
                if (data.maint_message && desc) { desc.innerHTML = `<b style="color:#fbbf24; white-space: pre-line;">${data.maint_message}</b>`; } 
                else if(desc) { desc.innerHTML = "Maintenance Mode."; }
                if (data.maint_end_ts) {
                    if(cd) {
                        cd.style.display = 'flex';
                        const runTimer = () => { const diff = (data.maint_end_ts || Date.now()) - Date.now(); if (diff <= 0) cd.innerHTML = "Finishing..."; else { const h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000), sec = Math.floor((diff % 60000) / 1000); cd.innerHTML = `${h}:${m}:${sec}`; } };
                        runTimer(); maintInterval = setInterval(runTimer, 1000);
                    }
                }
            }
        }
    }
});

function attemptShowNotice() {
    if(!user || !userData) return; 
    if(userData.status === 'pending' || userData.status === 'rejected' || userData.status === 'banned') return;
    const popup = document.getElementById('notice-modal');
    if(popup && globalNoticeData && globalNoticeData.active === true && globalNoticeData.text) {
        document.getElementById('notice-text').innerText = globalNoticeData.text;
        popup.style.display = 'flex';
    }
}
window.closeNotice = () => { document.getElementById('notice-modal').style.display = 'none'; sessionStorage.setItem('noticeSeen', 'true'); };

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

// --- AUTH ---
onAuthStateChanged(auth, u => {
    const loader = document.getElementById('startup-loader');
    const navBar = document.querySelector('.bottom-nav');
    if (!u && window.location.pathname.includes('services.html')) { window.location.href = 'index.html'; return; }
    if (u) {
        user = u;
        onValue(ref(db, 'users/' + u.uid), s => {
            userData = s.val();
            if(!userData) { signOut(auth); return; }
            if(userData.role === 'admin') { signOut(auth); alert("Admin access denied."); return; }
            startLiveNotifications(u.uid);
            if (loader) loader.style.display = 'none';
            if (userData.status === 'rejected' || userData.status === 'banned' || userData.status === 'pending') {
                if(userData.status === 'pending') document.getElementById('pending-view').style.display='flex';
                else if(userData.status === 'rejected') document.getElementById('rejected-view').style.display='flex';
                else document.body.innerHTML = "<h1 style='color:red;text-align:center;'>BANNED</h1>";
                document.getElementById('main-view').style.display='none';
                document.getElementById('auth-view').style.display='none';
                if(navBar) navBar.style.display = 'none';
                return;
            }
            updateUserDataUI();
            attemptShowNotice(); 
            document.getElementById('auth-view').style.display = 'none';
            if(navBar) navBar.style.display = 'flex';
            const urlParams = new URLSearchParams(window.location.search);
            const tab = urlParams.get('tab');
            if(tab === 'profile') { window.switchTab('profile', document.getElementById('nav-profile')); } else { if(document.getElementById('main-view')) document.getElementById('main-view').style.display = 'block'; }
            loadHistory(); 
            loadProfile();
        });
    } else {
        if(loader) loader.style.display = 'none';
        document.getElementById('auth-view').style.display = 'flex'; 
        document.getElementById('main-view').style.display = 'none'; 
        if(navBar) navBar.style.display = 'none';
    }
});

function updateUserDataUI() {
    const badgeHTML = userData.isVerified ? ' <i class="fas fa-check-circle verified-badge"></i>' : '';
    if(document.getElementById('u-name')) document.getElementById('u-name').innerHTML = userData.name + badgeHTML;
    if(document.getElementById('card-holder-name')) document.getElementById('card-holder-name').innerText = userData.name;
    if(document.getElementById('p-name')) document.getElementById('p-name').innerHTML = userData.name + badgeHTML;
    if(document.getElementById('u-bal')) document.getElementById('u-bal').innerText = userData.balance || 0;
    if(document.getElementById('p-phone')) document.getElementById('p-phone').innerText = userData.phone;
}

window.switchTab = (tab, el) => { 
    const views = ['main-view', 'profile-view'];
    views.forEach(v => { const elem = document.getElementById(v); if(elem) elem.style.display = 'none'; });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); 
    if(el) el.classList.add('active'); 
    if(tab === 'home') { if(document.getElementById('main-view')) document.getElementById('main-view').style.display = 'block'; if(window.location.pathname.includes('services.html')) window.location.href = 'index.html'; } 
    else if(tab === 'profile') { if(document.getElementById('profile-view')) { document.getElementById('profile-view').style.display = 'block'; loadProfile(); } else { window.location.href = 'index.html?tab=profile'; } }
};

window.toggleAuth = () => {
    const btnText = document.getElementById('auth-switch-text');
    const isLogin = document.getElementById('reg-fields').style.display === 'none';
    if (isLogin) { document.getElementById('reg-disclaimer-modal').style.display = 'block'; document.getElementById('auth-form-container').style.display = 'none'; } 
    else { document.getElementById('reg-fields').style.display = 'none'; document.getElementById('auth-btn').innerText = "LOGIN"; btnText.innerText = "Create New Account"; }
};
window.acceptDisclaimer = () => { document.getElementById('reg-disclaimer-modal').style.display = 'none'; document.getElementById('auth-form-container').style.display = 'block'; document.getElementById('reg-fields').style.display = 'block'; document.getElementById('auth-btn').innerText = "REGISTER"; document.getElementById('auth-switch-text').innerText = "Already have an account? Login"; };

window.authAction = async () => {
    const btn = document.getElementById('auth-btn'); const e = document.getElementById('email').value, p = document.getElementById('pass').value;
    const isReg = document.getElementById('reg-fields').style.display === 'block';
    if(!e || !p) return window.showPremiumAlert("Error", "Enter details", true);
    btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
    try {
        if(isReg) {
            const n = document.getElementById('r-name').value, ph = document.getElementById('r-phone').value, tg = document.getElementById('r-telegram').value; 
            if(!n || !ph || !tg) throw new Error("Name, Phone & Telegram required");
            const c = await createUserWithEmailAndPassword(auth, e, p);
            await set(ref(db, 'users/'+c.user.uid), { name: n, phone: ph, telegram: tg, email: e, role: 'user', status: 'pending', balance: 0, joined_at: Date.now() });
            window.showPremiumAlert("Success", "Registered! Wait for approval.");
            setTimeout(() => window.location.reload(), 2000);
        } else { await signInWithEmailAndPassword(auth, e, p); }
    } catch(err) { window.showPremiumAlert("Failed", err.message, true); } 
    finally { btn.innerHTML = isReg ? 'REGISTER' : 'LOGIN'; btn.disabled = false; }
};

window.logout = () => signOut(auth).then(() => window.location.href = 'index.html');

function loadHistory() { 
    onValue(ref(db, 'orders'), s => { 
        const list = document.getElementById('history-list'); if(!list) return; list.innerHTML = ""; 
        let t=0, c=0, x=0; const allOrders = [];
        s.forEach(o => { const v = o.val(); if(v.userId === user.uid) { v.key = o.key; allOrders.push(v); t++; if(v.status==='completed') c++; if(v.status==='cancelled') x++; } }); 
        allOrders.sort((a,b) => b.timestamp - a.timestamp);
        if(allOrders.length === 0) list.innerHTML = '<p style="text-align:center; font-size:12px; color:var(--text-muted)">No orders yet.</p>';
        
        allOrders.forEach(v => {
            // 12H Check
            let isExpired = false; 
            if(v.status === 'completed' && v.completed_at) { 
                if((Date.now() - v.completed_at) > 43200000) isExpired = true; 
            }
            
            // Only show chat if NOT expired
            let chatBtn = (!isExpired && v.status !== 'cancelled') 
                ? `<button class="chat-btn-small" onclick="window.openChat('${v.key}', '${v.orderId_visible}')"><i class="fas fa-comments"></i></button>` 
                : '';
                
            let clr = v.status==='completed'?'#10b981':(v.status==='cancelled'?'#ef4444':'#f59e0b'); 
            let noteHTML = (v.status === 'cancelled' && v.admin_note) ? `<div style="font-size:11px; color:#ef4444; background:#fef2f2; padding:5px; border-radius:4px; margin-top:5px;">Reason: ${v.admin_note}</div>` : ""; 
            list.innerHTML += `<div class="order-card"><div class="order-top"><b style="font-size:14px; color:var(--text);">${v.service}</b>${chatBtn}</div><div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-muted);"><span>#${v.orderId_visible}</span><span class="status-badge" style="color:${clr}; background:${clr}15;">${v.status.toUpperCase()}</span></div>${noteHTML}<div style="font-size:10px; color:var(--text-muted); text-align:right;">${new Date(v.timestamp).toLocaleDateString()}</div></div>`; 
        });
        if(document.getElementById('stat-total')) { document.getElementById('stat-total').innerText = t; document.getElementById('stat-comp').innerText = c; document.getElementById('stat-cancel').innerText = x; } 
    }); 
}

function loadProfile() { 
    onValue(ref(db, 'balance_requests'), s => { 
        const l = document.getElementById('deposit-list'); if(!l) return; l.innerHTML = ""; 
        let found = false; const reqs = [];
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
        if (data.status === 'completed') { sndSuccess.play().catch(()=>{}); window.showPremiumAlert('Order Completed! ✅', `Order #${data.orderId_visible || '..'} is successfully done.`, false); }
        else if (data.status === 'cancelled') { sndAlert.play().catch(()=>{}); window.showPremiumAlert('Order Cancelled ❌', `Order #${data.orderId_visible || '..'} was cancelled.`, true); }
    });
    const depositRef = query(ref(db, 'balance_requests'), orderByChild('uid'), equalTo(uid));
    onChildChanged(depositRef, (snapshot) => {
        const data = snapshot.val(); if(!data) return;
        if (data.status === 'approved') { sndSuccess.play().catch(()=>{}); window.showPremiumAlert('Money Added! 💰', `৳${data.amount} has been added to your balance.`, false); }
        else if (data.status === 'rejected') { sndAlert.play().catch(()=>{}); window.showPremiumAlert('Deposit Rejected ⚠️', `Request for ৳${data.amount} was rejected.`, true); }
    });
}

window.openPayModal = () => { document.getElementById('pay-modal').style.display='flex'; document.getElementById('pay-step-1').style.display='block'; document.getElementById('pay-step-2').style.display='none'; }
window.closePayModal = () => document.getElementById('pay-modal').style.display='none';
window.nextPayStep = () => { document.getElementById('pay-step-1').style.display='none'; document.getElementById('pay-step-2').style.display='block'; };

window.submitDeposit = async () => {
    const n = document.getElementById('d-name').value, m = document.getElementById('d-mobile').value, a = document.getElementById('d-amt').value, t = document.getElementById('d-trx').value;
    const fileInput = document.getElementById('d-proof-file'); let fileDataUrl = "";
    if(!n || !m || !a || !t) return window.showPremiumAlert("Missing Info", "Please fill all fields.", true);
    if(Number(a) < 200) return window.showPremiumAlert("Invalid Amount", "Minimum deposit is 200 BDT.", true);
    if(fileInput.files.length === 0) return window.showPremiumAlert("Missing Proof", "Please upload payment screenshot.", true);
    const btn = document.querySelector('#pay-modal .btn-main'); btn.innerHTML = "Uploading..."; btn.disabled = true;
    try {
        const file = fileInput.files[0]; if(file.size > 10 * 1024 * 1024) { btn.innerHTML = "Confirm"; btn.disabled = false; return window.showPremiumAlert("Error", "Image too large (Max 10MB)", true); }
        fileDataUrl = await processFile(file);
        await push(ref(db, 'balance_requests'), { uid: user.uid, uName: userData.name, accName: n, accMobile: m, amount: Number(a), trxId: t, screenshot: fileDataUrl, status: 'pending', timestamp: Date.now() });
        window.closePayModal(); window.showPremiumAlert("Submitted!", "Request sent for approval.");
        document.getElementById('d-name').value = ""; document.getElementById('d-mobile').value = ""; document.getElementById('d-amt').value = ""; document.getElementById('d-trx').value = ""; fileInput.value = ""; fileInput.parentNode.querySelector('.file-preview-name').innerText = "";
    } catch(e) { window.showPremiumAlert("Error", "Failed to upload.", true); } finally { btn.innerHTML = "Confirm"; btn.disabled = false; }
};

function renderCategories() {
    const catBar = document.getElementById('category-bar'); if(!catBar) return;
    catBar.innerHTML = `<div class="cat-chip ${activeCategory === "All" ? 'active' : ''}" onclick="window.filterServices('All', this)">All</div>`;
    Object.values(globalCategories).forEach(catName => { catBar.innerHTML += `<div class="cat-chip ${catName === activeCategory ? 'active' : ''}" onclick="window.filterServices('${catName}', this)">${catName}</div>`; });
}

window.renderServiceGrid = () => {
    const grid = document.getElementById('dynamic-services-grid'); if(!grid) return;
    const query = document.getElementById('search-inp') ? document.getElementById('search-inp').value.toLowerCase() : "";
    grid.innerHTML = ""; let hasService = false;
    Object.entries(globalServices).forEach(([key, svc]) => {
        const isCatMatch = activeCategory === "All" || (svc.category || "Others") === activeCategory;
        const isSearchMatch = svc.name.toLowerCase().includes(query);
        if (isCatMatch && isSearchMatch) {
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
    if(!hasService) grid.innerHTML = `<div style="grid-column: span 2; text-align: center; color:var(--text-muted); padding:20px;">No services found matching "${query}"</div>`;
};

window.filterServices = (cat, el) => { activeCategory = cat; document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active')); el.classList.add('active'); window.renderServiceGrid(); };

// --- OPEN ORDER (IMAGE LABEL FIX) ---
window.openOrder = (key) => {
    const svc = globalServices[key]; if(!svc) return;
    curSvcKey = key; curBasePrice = parseInt(svc.price); curFinalPrice = curBasePrice; 
    document.getElementById('ord-title').innerText = svc.name; document.getElementById('ord-cost').innerText = curFinalPrice;
    const instrBox = document.getElementById('ord-instruction');
    if(instrBox) { if(svc.instruction && svc.instruction.trim() !== "") { instrBox.style.display = 'block'; instrBox.innerHTML = svc.instruction.replace(/\n/g, "<br>"); } else { instrBox.style.display = 'none'; } }
    const formContainer = document.getElementById('ord-dynamic-form'); formContainer.innerHTML = ""; const fields = globalForms[key] || [];
    if(fields.length === 0) formContainer.innerHTML = `<div class="form-group"><label class="input-label">Details</label><textarea class="auth-inp dynamic-field" data-label="Details" rows="4"></textarea></div>`;
    else {
        fields.forEach(f => {
            let html = ""; const safeLabel = f.label.replace(/[^a-zA-Z0-9]/g, '_');
            if(f.type === 'textarea') html = `<textarea class="auth-inp dynamic-field" data-label="${f.label}" rows="4" placeholder="${f.label}"></textarea>`;
            else if (f.type === 'link') html = `<input class="auth-inp dynamic-field" type="url" data-label="${f.label}" placeholder="https://...">`;
            // Fixed Image Input with Label
            else if (f.type === 'file_url') {
                html = `<div class="form-group"><label class="input-label" style="margin-bottom: 5px; display: block;">${f.label}</label><div class="file-upload-wrapper"><input type="file" class="file-upload-input dynamic-file-field" data-label="${f.label}" accept="image/*" onchange="window.handleFileSelect(this)"><div class="file-upload-label"><i class="fas fa-cloud-upload-alt"></i> Choose Image from Gallery</div><span class="file-preview-name"></span></div></div>`;
            }
            else if(f.type === 'radio_grid') {
                const opts = f.options.split(',').map(s => s.trim()); let boxes = "";
                opts.forEach(opt => { const parts = opt.split('='); const name = parts[0].trim(); let price = null; if (parts.length > 1 && !isNaN(parseInt(parts[1].trim()))) price = parseInt(parts[1].trim()); const priceAttr = price ? `data-price="${price}"` : ''; const priceDisplay = price ? `<span class="opt-price-tag">৳ ${price}</span>` : ''; boxes += `<div class="select-option" onclick="window.selectOption(this, '${safeLabel}')" ${priceAttr} data-val="${name}">${name}${priceDisplay}</div>`; });
                html = `<div class="select-box-grid" id="grp-${safeLabel}">${boxes}</div><input type="hidden" class="dynamic-field" data-label="${f.label}" id="input-${safeLabel}">`;
            } else html = `<input class="auth-inp dynamic-field" type="${f.type}" data-label="${f.label}" placeholder="${f.label}">`;
            
            if(f.type !== 'file_url') formContainer.innerHTML += `<div class="form-group"><label class="input-label">${f.label}</label>${html}</div>`;
            else formContainer.innerHTML += html; 
        });
    }
    document.getElementById('ord-modal').style.display = 'flex';
};

window.handleFileSelect = (input) => { const fileNameSpan = input.parentNode.querySelector('.file-preview-name'); if (input.files && input.files[0]) fileNameSpan.innerText = "Selected: " + input.files[0].name; else fileNameSpan.innerText = ""; };
window.selectOption = (el, label) => { const grp = document.getElementById(`grp-${label}`); if (grp) { grp.querySelectorAll('.select-option').forEach(b => b.classList.remove('active')); el.classList.add('active'); document.getElementById(`input-${label}`).value = el.getAttribute('data-val'); const priceOverride = el.getAttribute('data-price'); if(priceOverride) curFinalPrice = parseInt(priceOverride); else curFinalPrice = curBasePrice; document.getElementById('ord-cost').innerText = curFinalPrice; } };

window.confirmOrder = async () => {
    const btn = document.querySelector('#ord-modal .btn-main'); const inputs = document.querySelectorAll('.dynamic-field'); let details = ""; let empty = false;
    inputs.forEach(i => { const val = i.value.trim(); const lbl = i.getAttribute('data-label'); if(!val) empty = true; details += `${lbl}: ${val}\n`; });
    const fileInputs = document.querySelectorAll('.dynamic-file-field'); let fileDataUrl = ""; let hasFileField = fileInputs.length > 0; let fileSelected = false;
    if(hasFileField) { const fileInput = fileInputs[0]; if(fileInput.files.length > 0) { fileSelected = true; const file = fileInput.files[0]; if(file.size > 10 * 1024 * 1024) return window.showPremiumAlert("Error", "Image too large (Max 10MB)", true); btn.innerHTML = "Uploading..."; btn.disabled = true; try { fileDataUrl = await processFile(file); } catch (e) { btn.innerHTML = "Order Now"; btn.disabled = false; return window.showPremiumAlert("Error", "Failed to read file", true); } } }
    if(empty) { if(hasFileField) { btn.innerHTML = "Order Now"; btn.disabled = false; } return window.showPremiumAlert("Missing Info", "Please fill all text fields.", true); }
    if(hasFileField && !fileSelected) { if(hasFileField) { btn.innerHTML = "Order Now"; btn.disabled = false; } return window.showPremiumAlert("Missing Info", "Please select an image.", true); }
    btn.innerHTML = "Processing..."; btn.disabled = true;
    runTransaction(ref(db, 'users/' + user.uid + '/balance'), (bal) => { if (bal >= curFinalPrice) return bal - curFinalPrice; return; }).then(async (res) => { 
        if(res.committed) { 
            const shortId = Math.floor(100000 + Math.random() * 900000).toString(); 
            const newOrderRef = push(ref(db, 'orders')); 
            await set(newOrderRef, { userId: user.uid, uName: userData.name, service: globalServices[curSvcKey].name, cost: curFinalPrice, details: details, file: fileDataUrl, status: 'pending', timestamp: Date.now(), orderId_visible: shortId }); 
            window.showPremiumAlert("Success", "Order Placed!"); 
            await push(ref(db, 'chats/'+newOrderRef.key), {s:'sys', t:`Order Placed. ID: ${shortId}`});
            const autoMsg = "আপনার অর্ডার অ্যাডমিন প্যানেলে সাবমিট হয়েছে। একজন অ্যাডমিন শীঘ্রই আপনার সাথে কথা বলবেন। ততক্ষণ চ্যাট বক্সে থাকুন। ধন্যবাদ।";
            await push(ref(db, 'chats/'+newOrderRef.key), {s:'admin', t: autoMsg});
            document.getElementById('ord-modal').style.display='none'; 
            window.openChat(newOrderRef.key, shortId); 
        } else window.showPremiumAlert("Failed", "Insufficient Balance!", true); 
        btn.innerHTML = "Order Now"; btn.disabled = false;
    }).catch(e => { btn.innerHTML = "Order Now"; btn.disabled = false; window.showPremiumAlert("Error", "Transaction failed", true); });
};

window.handleChatFile = async (input) => {
    const file = input.files[0]; if(!file) return;
    if(file.size > 10 * 1024 * 1024) { window.showPremiumAlert("File too large", "Max size is 10MB.", true); input.value = ""; return; }
    window.showPremiumAlert("Uploading...", "Please wait.");
    try {
        const base64 = await processFile(file);
        const type = file.type.startsWith('image/') ? 'image' : 'file';
        if(activeChat) { await push(ref(db, 'chats/'+activeChat), { s: user.uid, type: type, file: base64, fileName: file.name, t: "", timestamp: Date.now() }); input.value = ""; }
    } catch(e) { window.showPremiumAlert("Error", "Failed to send file.", true); }
};

// --- CHAT LOGIC (12H AUTO DELETE + TELEGRAM FIX) ---
window.openChat = (k, id) => { 
    const chatModal = document.getElementById('chat-modal'); if(!chatModal) return;
    
    // Clear & Load
    document.getElementById('chat-box').innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
    
    activeChat = k; 
    
    if(document.getElementById('chat-head')) document.getElementById('chat-head').innerText = "Chat #" + id; 
    const inp = document.getElementById('chat-input-wrap'), cls = document.getElementById('chat-closed-wrap'); 
    if (orderStatusListener) off(orderStatusListener); 
    
    const EXPIRY_TIME_MS = 12 * 60 * 60 * 1000;

    orderStatusListener = onValue(ref(db, 'orders/' + k), (s) => { 
        const data = s.val(); 
        
        if(!data || data.status === 'cancelled') { window.closeChatModal(); return; } 
        
        if (chatTimerInterval) clearInterval(chatTimerInterval); 
        
        // Expiry Check
        if (data.status === 'completed' && data.completed_at) {
            const timePassed = Date.now() - data.completed_at;
            if (timePassed > EXPIRY_TIME_MS) {
                remove(ref(db, 'chats/'+k));
                window.closeChatModal();
                window.showPremiumAlert("Chat Expired", "12 hours passed. Chat is now closed.", true);
                return;
            }
        }

        if (data.status === 'pending') { 
            inp.style.display = 'flex'; cls.style.display = 'none'; 
        } else if (data.status === 'processing') { 
            inp.style.display = 'none'; cls.style.display = 'block'; cls.className = 'chat-closed-ui processing'; 
            cls.innerHTML = '<i class="fas fa-lock"></i> অর্ডার প্রসেসিং এ আছে। চ্যাট বন্ধ।'; 
        } else if (data.status === 'completed') { 
            inp.style.display = 'none'; cls.style.display = 'block'; cls.className = 'chat-closed-ui'; 
            
            const updateTimer = () => { 
                const diff = EXPIRY_TIME_MS - (Date.now() - (data.completed_at || 0)); 
                if (diff <= 0) { 
                    clearInterval(chatTimerInterval); 
                    remove(ref(db, 'chats/'+k)); 
                    window.closeChatModal(); 
                    window.showPremiumAlert("Chat Expired", "Time limit reached.", true);
                } else { 
                    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)); 
                    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    cls.innerHTML = `<i class="fas fa-history"></i> Chat expiring in: ${h}h ${m}m`; 
                } 
            }; 
            updateTimer(); 
            chatTimerInterval = setInterval(updateTimer, 60000); 
        } 
    }); 
    
    chatModal.style.display='flex'; 

    let isChatInit = true;
    onValue(ref(db, 'chats/'+k), s => { 
        const b = document.getElementById('chat-box'); 
        if(!b) return;
        b.innerHTML=""; 
        const chatData = []; let newMsgFound = false;
        
        if(s.exists()) {
            s.forEach(c => { const m = c.val(); chatData.push(m); if (!isChatInit && m.s !== user.uid) newMsgFound = true; });
        }
        if(newMsgFound) sndMsg.play().catch(()=>{}); isChatInit = false; 
        
        chatData.forEach(m => { 
            const isMe = (m.s === user.uid); let content = "";
            
            // --- UPDATED VIEW & DOWNLOAD ---
            if(m.type === 'image') {
                content = `
                    <img src="${m.file}" class="chat-img-preview"><br>
                    <div style="display:flex; gap:5px; margin-top:5px;">
                        <button class="chat-file-download" onclick="window.downloadMedia('${m.file}', '${m.fileName || 'image.jpg'}')">
                            <i class="fas fa-download"></i> Save
                        </button>
                        <button class="chat-file-download" style="background:rgba(0,0,0,0.2);" onclick="window.viewImage('${m.file}')">
                            <i class="fas fa-eye"></i> View
                        </button>
                    </div>`;
            } else if (m.type === 'file') {
                content = `
                    <div style="display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-file" style="font-size:20px;"></i> <span>${m.fileName || 'File'}</span>
                    </div>
                    <button class="chat-file-download" onclick="window.downloadMedia('${m.file}', '${m.fileName || 'file.txt'}')">
                        <i class="fas fa-download"></i> Download File
                    </button>`;
            } else {
                const linkify = (text) => { const urlRegex = /(https?:\/\/[^\s]+)/g; return text.replace(urlRegex, function(url) { return `<a href="${url}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="color:inherit; text-decoration:underline; font-weight:bold; word-break: break-all;">${url}</a>`; }); };
                const msgContent = linkify(m.t || "");
                // Safe Copy Logic
                const safeText = encodeURIComponent(m.t || "");
                const copyIcon = `<i class="fas fa-copy copy-btn-icon" onclick="event.stopPropagation(); window.copyText(decodeURIComponent('${safeText}'))"></i>`;
                const textColor = isMe ? 'white' : 'var(--text)';
                content = `<span style="color:${textColor}; display:block;">${msgContent}</span>${copyIcon}`;
            }
            b.innerHTML += `<div class="msg-row ${isMe?'me':'adm'}"><div class="msg ${isMe?'msg-me':'msg-adm'}">${content}</div></div>`; 
        }); 
        b.scrollTop = b.scrollHeight; 
    }); 
};

window.sendMsg = () => { const t = document.getElementById('chat-in').value; if(t && activeChat) { push(ref(db, 'chats/'+activeChat), {s:user.uid, t:t, type: 'text', timestamp: Date.now()}); document.getElementById('chat-in').value=""; } };
window.closeChatModal = () => { document.getElementById('chat-modal').style.display='none'; if (chatTimerInterval) clearInterval(chatTimerInterval); if(orderStatusListener) off(orderStatusListener); };

// ================= SECURITY MODULE =================
document.addEventListener('contextmenu', event => event.preventDefault());
document.onkeydown = function(e) { if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) || (e.ctrlKey && e.keyCode === 85)) return false; };
window.addEventListener('blur', () => { document.body.classList.add('blur-mode'); document.title = "⚠️ Security Alert"; });
window.addEventListener('focus', () => { document.body.classList.remove('blur-mode'); document.title = "Siͥleͣnͫt Cyber Raid Portal"; });
document.querySelectorAll('img').forEach(img => { img.addEventListener('dragstart', e => e.preventDefault()); });
