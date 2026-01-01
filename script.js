import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, runTransaction, off, query, orderByChild, equalTo, onChildChanged, remove } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

// --- AUTO LOAD PDF ENGINE ---
const pdfScript = document.createElement('script');
pdfScript.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
pdfScript.onload = () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
};
document.head.appendChild(pdfScript);

// Prevent user script on admin page
if (window.location.pathname.includes('admin.html')) {
    throw new Error("User script halted on Admin Page.");
}

// --- SOUNDS ---
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

// --- VIEWER CSS ---
const viewerStyle = document.createElement('style');
viewerStyle.innerHTML = `
    .media-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #0f172a; z-index: 99999; display: flex; flex-direction: column; }
    .viewer-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #1e293b; border-bottom: 1px solid #334155; color: white; }
    .viewer-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }
    .viewer-close { background: rgba(255,255,255,0.1); width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px; }
    .viewer-body { flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 10px; background: #000; position: relative; }
    .media-content { max-width: 100%; height: auto; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
    #pdf-canvas { direction: ltr; background: white; margin-bottom: 100px; max-width: 100%; box-shadow: 0 0 15px rgba(0,0,0,0.5); }
    
    .viewer-controls { position: fixed; bottom: 0; left: 0; width: 100%; background: #1e293b; padding: 15px 10px; display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 10px; border-top: 1px solid #334155; z-index: 100000; padding-bottom: max(15px, env(safe-area-inset-bottom)); }
    .ctrl-btn { background: #334155; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 18px; }
    .ctrl-btn.primary { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; font-weight: bold; font-size: 14px; }
    .pdf-nav { position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); background: rgba(30, 41, 59, 0.9); padding: 8px 15px; border-radius: 30px; display: none; gap: 15px; align-items: center; color: white; font-size: 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); z-index: 100000; }
    .nav-btn { background: none; border: none; color: white; font-size: 16px; cursor: pointer; }
    .loading-spinner { border: 4px solid rgba(255,255,255,0.1); border-top: 4px solid #3b82f6; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; position: absolute; top: 50%; left: 50%; margin-left: -20px; margin-top: -20px; }
`;
document.head.appendChild(viewerStyle);

// --- UTILS ---
const base64ToBlob = (base64Data) => {
    try {
        if (!base64Data || !base64Data.includes(',')) return null;
        const parts = base64Data.split(',');
        const mime = parts[0].match(/:(.*?);/)[1];
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) { u8arr[n] = bstr.charCodeAt(n); }
        return new Blob([u8arr], { type: mime });
    } catch(e) { return null; }
};

window.showPremiumAlert = (title, msg, isError = false) => {
    let container = document.getElementById('toast-container');
    if(!container) { container = document.createElement('div'); container.id = 'toast-container'; container.className = 'toast-container'; document.body.appendChild(container); }
    const toast = document.createElement('div'); toast.className = `premium-toast ${isError ? 'error' : 'success'}`;
    toast.innerHTML = `<div class="p-toast-icon">${isError ? '<i class="fas fa-times-circle"></i>' : '<i class="fas fa-check-circle"></i>'}</div><div class="p-toast-content"><h4>${title}</h4><p>${msg}</p></div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(-20px)'; setTimeout(() => toast.remove(), 500); }, 3500);
};

window.copyText = (text) => {
    const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.focus(); t.select();
    try { document.execCommand('copy'); window.showPremiumAlert("Copied! 📋", "Text copied."); } catch (err) {} document.body.removeChild(t);
};

// ===============================================
// --- ROBUST FILE DOWNLOADER (PC & MOBILE) ---
// ===============================================

window.downloadFile = (base64Data, fileName) => {
    const blob = base64ToBlob(base64Data);
    if (!blob) return window.showPremiumAlert("Error", "File corrupted", true);

    const fileObj = new File([blob], fileName, { type: blob.type });
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // METHOD 1: Mobile Native Share (Telegram Preferred)
    if (isMobile && navigator.share && navigator.canShare({ files: [fileObj] })) {
        navigator.share({
            files: [fileObj],
            title: fileName,
            text: "Downloaded from Silent Portal"
        }).then(() => {
            window.showPremiumAlert("Saved", "File saved successfully.");
        }).catch((e) => {
            // Share cancelled or failed, Fallback to Method 2
            console.log("Share failed, trying fallback");
            triggerDirectDownload(blob, fileName);
        });
    } else {
        // METHOD 2: Direct Download (PC / Fallback)
        triggerDirectDownload(blob, fileName);
    }
};

function triggerDirectDownload(blob, fileName) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.showPremiumAlert("Downloading...", "Check downloads folder.");
    setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 2000);
}

// --- VIEWER ---
window.handleMediaClick = async (base64Data, fileName, type) => {
    const overlay = document.createElement('div');
    overlay.className = 'media-overlay';
    let isImage = type === 'image' || (fileName && fileName.match(/\.(jpeg|jpg|png|gif)$/i));
    const safeName = fileName ? fileName.replace(/[^a-zA-Z0-9.]/g, '_') : `file_${Date.now()}.${isImage?'jpg':'pdf'}`;

    overlay.innerHTML = `
        <div class="viewer-header">
            <div class="viewer-title">${fileName || 'Document'}</div>
            <div class="viewer-close" id="close-viewer">✕</div>
        </div>
        <div class="viewer-body" id="viewer-body">
            <div class="loading-spinner" id="spinner"></div>
        </div>
        <div class="pdf-nav" id="pdf-nav">
            <button class="nav-btn" id="prev-page"><i class="fas fa-chevron-left"></i></button>
            <span id="page-num">1 / 1</span>
            <button class="nav-btn" id="next-page"><i class="fas fa-chevron-right"></i></button>
        </div>
        <div class="viewer-controls">
            <button class="ctrl-btn secondary" id="zoom-toggle"><i class="fas fa-search-plus"></i></button>
            <button class="ctrl-btn primary" id="dl-btn"><i class="fas fa-download"></i> Save File</button>
            <button class="ctrl-btn secondary" id="ext-btn"><i class="fas fa-external-link-alt"></i></button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    document.getElementById('close-viewer').onclick = () => overlay.remove();

    const body = document.getElementById('viewer-body');
    const spinner = document.getElementById('spinner');
    let scale = 1;

    if (isImage) {
        spinner.style.display = 'none';
        const img = document.createElement('img');
        img.src = base64Data;
        img.className = 'media-content';
        body.appendChild(img);
        document.getElementById('zoom-toggle').onclick = () => { scale = scale===1 ? 2 : 1; img.style.transform=`scale(${scale})`; img.style.transition="0.3s"; };
    } else {
        let pdfDoc=null, canvas=document.createElement('canvas'), ctx=canvas.getContext('2d'), pageNum=1;
        canvas.id='pdf-canvas'; body.appendChild(canvas);
        const pdfNav = document.getElementById('pdf-nav');

        try {
            const pdfData = atob(base64Data.split(',')[1]);
            if(typeof pdfjsLib === 'undefined') throw new Error("Loading...");
            const loadingTask = pdfjsLib.getDocument({data: pdfData});
            pdfDoc = await loadingTask.promise;
            
            spinner.style.display='none'; pdfNav.style.display='flex';
            
            const renderPage = async (num) => {
                const page = await pdfDoc.getPage(num);
                const viewport = page.getViewport({scale: scale});
                canvas.height = viewport.height; canvas.width = viewport.width;
                await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                document.getElementById('page-num').innerText = `${num} / ${pdfDoc.numPages}`;
            };
            renderPage(pageNum);

            document.getElementById('prev-page').onclick = () => { if(pageNum>1) {pageNum--; renderPage(pageNum);} };
            document.getElementById('next-page').onclick = () => { if(pageNum<pdfDoc.numPages) {pageNum++; renderPage(pageNum);} };
            document.getElementById('zoom-toggle').onclick = () => { scale = scale===1.0 ? 1.5 : 1.0; renderPage(pageNum); };
        } catch(e) {
            spinner.style.display='none'; body.innerHTML = `<p style="color:#ef4444;text-align:center;margin-top:50px;">Preview Unavailable.<br>Please Download.</p>`;
        }
    }

    // --- DOWNLOAD BUTTON ---
    document.getElementById('dl-btn').onclick = () => window.downloadFile(base64Data, safeName);
    
    // --- EXTERNAL OPEN ---
    document.getElementById('ext-btn').onclick = () => {
        const blob = base64ToBlob(base64Data);
        if(blob) {
            const url = window.URL.createObjectURL(blob);
            window.open(url, '_blank');
        }
    };
};

// --- DATA LOAD & SERVICES FIX ---
onValue(ref(db, 'settings'), (s) => {
    const data = s.val() || {};
    globalCategories = data.categories || {};
    globalServices = data.services_list || {}; // MUST LOAD BEFORE RENDERING
    globalForms = data.service_forms || {};
    
    // Ensure "All" category exists logically
    if (Object.keys(globalServices).length === 0) {
        console.warn("No services found in database.");
    }

    // Render immediately after data load
    if(document.getElementById('category-bar')) renderCategories();
    if(document.getElementById('dynamic-services-grid')) renderServiceGrid();
    
    if(data.fake_counter) { fakeSettings = data.fake_counter; updateTotalDisplay(); }
    const marqueeBar = document.getElementById('marquee-bar');
    if(marqueeBar) {
        if(data.announcement) { marqueeBar.style.display = 'block'; document.getElementById('marquee-text').innerText = data.announcement; }
        else marqueeBar.style.display = 'none';
    }
    if(data.popup_notice) { globalNoticeData = data.popup_notice; attemptShowNotice(); }
    
    // System Status Logic
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
            } else if (data.system_status === 'maintenance') {
                if(icon) icon.innerHTML = '<i class="fas fa-tools pulse-anim" style="color:#f59e0b;"></i>'; 
                if(title) title.innerText = "System Maintenance";
                if (data.maint_message && desc) { desc.innerHTML = `<b style="color:#fbbf24;">${data.maint_message}</b>`; } 
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
        if(sessionStorage.getItem('noticeSeen') !== 'true') {
            document.getElementById('notice-text').innerText = globalNoticeData.text;
            popup.style.display = 'flex';
        }
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

// --- SERVICES RENDERER FIX ---
window.renderServiceGrid = () => {
    const grid = document.getElementById('dynamic-services-grid'); if(!grid) return;
    const query = document.getElementById('search-inp') ? document.getElementById('search-inp').value.toLowerCase() : "";
    grid.innerHTML = ""; 
    let hasService = false;
    
    if(!globalServices || Object.keys(globalServices).length === 0) {
        grid.innerHTML = `<div style="grid-column: span 2; text-align: center; color:var(--text-muted); padding:20px;">Loading Services...</div>`;
        return;
    }

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

window.filterServices = (cat, el) => { 
    activeCategory = cat; 
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active')); 
    if(el) el.classList.add('active'); 
    window.renderServiceGrid(); 
};

function renderCategories() {
    const catBar = document.getElementById('category-bar'); if(!catBar) return;
    catBar.innerHTML = `<div class="cat-chip ${activeCategory === "All" ? 'active' : ''}" onclick="window.filterServices('All', this)">All</div>`;
    if(globalCategories) {
        Object.values(globalCategories).forEach(catName => { 
            catBar.innerHTML += `<div class="cat-chip ${catName === activeCategory ? 'active' : ''}" onclick="window.filterServices('${catName}', this)">${catName}</div>`; 
        });
    }
}

// --- STANDARD APP LOGIC (AUTH, ORDERS, CHAT) ---
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
            if(tab === 'profile') { window.switchTab('profile', document.getElementById('nav-profile')); } 
            else { if(document.getElementById('main-view')) document.getElementById('main-view').style.display = 'block'; }
            loadHistory(); loadProfile();
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
    if(document.getElementById('u-bal')) document.getElementById('u-bal').innerText = userData.balance || 0;
    if(document.getElementById('card-holder-name')) document.getElementById('card-holder-name').innerText = userData.name;
    if(document.getElementById('p-name')) document.getElementById('p-name').innerHTML = userData.name + badgeHTML;
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

window.authAction = async () => {
    const btn = document.getElementById('auth-btn'); const e = document.getElementById('email').value, p = document.getElementById('pass').value;
    const isReg = document.getElementById('reg-fields').style.display === 'block';
    if(!e || !p) return window.showPremiumAlert("Error", "Enter details", true);
    btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
    try {
        if(isReg) {
            const n = document.getElementById('r-name').value, ph = document.getElementById('r-phone').value, tg = document.getElementById('r-telegram').value; 
            if(!n || !ph || !tg) throw new Error("All fields required");
            const c = await createUserWithEmailAndPassword(auth, e, p);
            await set(ref(db, 'users/'+c.user.uid), { name: n, phone: ph, telegram: tg, email: e, role: 'user', status: 'pending', balance: 0, joined_at: Date.now() });
            window.showPremiumAlert("Success", "Registered! Wait for approval.");
            setTimeout(() => window.location.reload(), 2000);
        } else { await signInWithEmailAndPassword(auth, e, p); }
    } catch(err) { window.showPremiumAlert("Failed", err.message, true); } 
    finally { btn.innerHTML = isReg ? 'REGISTER' : 'LOGIN'; btn.disabled = false; }
};

window.toggleAuth = () => {
    const isLogin = document.getElementById('reg-fields').style.display === 'none';
    if(isLogin) { document.getElementById('reg-disclaimer-modal').style.display='block'; document.getElementById('auth-form-container').style.display='none'; }
    else { document.getElementById('reg-fields').style.display='none'; document.getElementById('auth-btn').innerText="LOGIN"; document.getElementById('auth-switch-text').innerText="Create New Account"; }
};
window.acceptDisclaimer = () => { document.getElementById('reg-disclaimer-modal').style.display='none'; document.getElementById('auth-form-container').style.display='block'; document.getElementById('reg-fields').style.display='block'; document.getElementById('auth-btn').innerText="REGISTER"; document.getElementById('auth-switch-text').innerText="Already have an account? Login"; };
window.logout = () => signOut(auth).then(() => window.location.href = 'index.html');

// --- HISTORY & ORDERS ---
function loadHistory() { 
    onValue(ref(db, 'orders'), s => { 
        const list = document.getElementById('history-list'); if(!list) return; list.innerHTML = ""; 
        let t=0, c=0, x=0; const allOrders = [];
        s.forEach(o => { const v = o.val(); if(v.userId === user.uid) { v.key = o.key; allOrders.push(v); t++; if(v.status==='completed') c++; if(v.status==='cancelled') x++; } }); 
        allOrders.sort((a,b) => b.timestamp - a.timestamp);
        if(allOrders.length === 0) list.innerHTML = '<p style="text-align:center; font-size:12px; color:var(--text-muted)">No orders yet.</p>';
        allOrders.forEach(v => {
            let isExpired = false; 
            if(v.status === 'completed' && v.completed_at) { if((Date.now() - v.completed_at) > 43200000) isExpired = true; }
            let chatBtn = (!isExpired && v.status !== 'cancelled') ? `<button class="chat-btn-small" onclick="window.openChat('${v.key}', '${v.orderId_visible}')"><i class="fas fa-comments"></i></button>` : '';
            let clr = v.status==='completed'?'#10b981':(v.status==='cancelled'?'#ef4444':'#f59e0b'); 
            list.innerHTML += `<div class="order-card"><div class="order-top"><b style="font-size:14px;">${v.service}</b>${chatBtn}</div><div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-muted);"><span>#${v.orderId_visible}</span><span class="status-badge" style="color:${clr}; background:${clr}15;">${v.status.toUpperCase()}</span></div><div style="font-size:10px; color:var(--text-muted); text-align:right;">${new Date(v.timestamp).toLocaleDateString()}</div></div>`; 
        });
        if(document.getElementById('stat-total')) { document.getElementById('stat-total').innerText = t; document.getElementById('stat-comp').innerText = c; document.getElementById('stat-cancel').innerText = x; } 
    }); 
}

function loadProfile() { 
    onValue(ref(db, 'balance_requests'), s => { 
        const l = document.getElementById('deposit-list'); if(!l) return; l.innerHTML = ""; 
        let found = false; const reqs = [];
        s.forEach(r => { const d = r.val(); if(d.uid === user.uid) { reqs.push(d); found = true; } });
        reqs.sort((a,b) => b.timestamp - a.timestamp);
        reqs.forEach(d => {
            let clr = d.status==='approved'?'#10b981':(d.status==='rejected'?'#ef4444':'#f59e0b'); 
            l.innerHTML += `<div class="hist-card" style="flex-direction:column; align-items:flex-start;"><div style="display:flex; justify-content:space-between; width:100%; align-items:center;"><div><div style="font-weight:600; font-size:13px;">৳ ${d.amount}</div><div style="font-size:10px; color:var(--text-muted);">${d.trxId}</div></div><span class="status-badge" style="color:${clr}; background:${clr}15;">${d.status}</span></div></div>`;
        });
        if(!found) l.innerHTML = `<p style="text-align:center; color:var(--text-muted); font-size:12px;">No history found.</p>`;
    }); 
}

onValue(ref(db, 'orders'), (s) => { let count = 0; s.forEach(() => { count++; }); realOrderCount = count; updateTotalDisplay(); });
function updateTotalDisplay() {
    const el = document.getElementById('fake-total-orders'); if(!el) return;
    let total = realOrderCount + (parseInt(fakeSettings.base) || 0);
    if(fakeSettings.auto && fakeSettings.start_ts) { const now = Date.now(); const mins = (now - fakeSettings.start_ts) / (1000 * 60); total += Math.floor(mins); }
    el.innerText = total.toLocaleString();
}
setInterval(updateTotalDisplay, 30000);

// --- MODALS & FORMS ---
window.openPayModal = () => { document.getElementById('pay-modal').style.display='flex'; document.getElementById('pay-step-1').style.display='block'; document.getElementById('pay-step-2').style.display='none'; }
window.closePayModal = () => document.getElementById('pay-modal').style.display='none';
window.nextPayStep = () => { document.getElementById('pay-step-1').style.display='none'; document.getElementById('pay-step-2').style.display='block'; };

window.submitDeposit = async () => {
    const n = document.getElementById('d-name').value, m = document.getElementById('d-mobile').value, a = document.getElementById('d-amt').value, t = document.getElementById('d-trx').value;
    const fileInput = document.getElementById('d-proof-file');
    if(!n || !m || !a || !t) return window.showPremiumAlert("Missing Info", "All fields required", true);
    const btn = document.querySelector('#pay-modal .btn-main'); btn.innerHTML = "Processing..."; btn.disabled = true;
    try {
        let fileDataUrl = "";
        if(fileInput.files.length > 0) fileDataUrl = await processFile(fileInput.files[0]);
        await push(ref(db, 'balance_requests'), { uid: user.uid, uName: userData.name, accName: n, accMobile: m, amount: Number(a), trxId: t, screenshot: fileDataUrl, status: 'pending', timestamp: Date.now() });
        window.closePayModal(); window.showPremiumAlert("Success", "Request Submitted!");
    } catch(e) { window.showPremiumAlert("Error", "Failed", true); } finally { btn.innerHTML = "Confirm"; btn.disabled = false; }
};

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
            if(f.type === 'textarea') html = `<textarea class="auth-inp dynamic-field" data-label="${f.label}" rows="4"></textarea>`;
            else if (f.type === 'link') html = `<input class="auth-inp dynamic-field" type="url" data-label="${f.label}" placeholder="https://...">`;
            else if (f.type === 'file_url') {
                html = `<div class="form-group"><label class="input-label" style="margin-bottom:5px;display:block;">${f.label}</label><div class="file-upload-wrapper"><input type="file" class="file-upload-input dynamic-file-field" data-label="${f.label}" accept="*/*" onchange="window.handleFileSelect(this)"><div class="file-upload-label"><i class="fas fa-cloud-upload-alt"></i> Choose File</div><span class="file-preview-name"></span></div></div>`;
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
    const fileInputs = document.querySelectorAll('.dynamic-file-field'); let fileDataUrl = ""; 
    if(fileInputs.length > 0) { const fileInput = fileInputs[0]; if(fileInput.files.length > 0) { const file = fileInput.files[0]; if(file.size > 10 * 1024 * 1024) return window.showPremiumAlert("Error", "File too large", true); try { fileDataUrl = await processFile(file); } catch (e) { return window.showPremiumAlert("Error", "File error", true); } } }
    if(empty) return window.showPremiumAlert("Missing Info", "Fill all fields", true);
    
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
    }).catch(e => { btn.innerHTML = "Order Now"; btn.disabled = false; window.showPremiumAlert("Error", "Failed", true); });
};

// --- CHAT & FILE ---
window.handleChatFile = async (input) => {
    const file = input.files[0]; if(!file) return;
    if(file.size > 10 * 1024 * 1024) { window.showPremiumAlert("Error", "Max 10MB", true); input.value = ""; return; }
    window.showPremiumAlert("Uploading...", "Please wait.");
    try {
        const base64 = await processFile(file);
        const type = file.type.startsWith('image/') ? 'image' : 'file';
        if(activeChat) { await push(ref(db, 'chats/'+activeChat), { s: user.uid, type: type, file: base64, fileName: file.name, t: "", timestamp: Date.now() }); input.value = ""; }
    } catch(e) { window.showPremiumAlert("Error", "Upload failed", true); }
};

window.openChat = (k, id) => { 
    const chatModal = document.getElementById('chat-modal'); if(!chatModal) return;
    document.getElementById('chat-box').innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Loading...</div>';
    activeChat = k; 
    if(document.getElementById('chat-head')) document.getElementById('chat-head').innerText = "Chat #" + id; 
    const inp = document.getElementById('chat-input-wrap'), cls = document.getElementById('chat-closed-wrap'); 
    if (orderStatusListener) off(orderStatusListener); 
    const EXPIRY = 12 * 60 * 60 * 1000;

    orderStatusListener = onValue(ref(db, 'orders/' + k), (s) => { 
        const data = s.val(); 
        if(!data || data.status === 'cancelled') { window.closeChatModal(); return; } 
        if (chatTimerInterval) clearInterval(chatTimerInterval); 
        if (data.status === 'completed' && data.completed_at) {
            if ((Date.now() - data.completed_at) > EXPIRY) { remove(ref(db, 'chats/'+k)); window.closeChatModal(); return; }
        }
        if (data.status === 'pending') { inp.style.display = 'flex'; cls.style.display = 'none'; } 
        else if (data.status === 'processing') { inp.style.display = 'none'; cls.style.display = 'block'; cls.className = 'chat-closed-ui processing'; cls.innerHTML = 'অর্ডার প্রসেসিং এ আছে। চ্যাট বন্ধ।'; } 
        else if (data.status === 'completed') { 
            inp.style.display = 'none'; cls.style.display = 'block'; cls.className = 'chat-closed-ui'; 
            const updateTimer = () => { 
                const diff = EXPIRY - (Date.now() - (data.completed_at || 0)); 
                if (diff <= 0) { clearInterval(chatTimerInterval); remove(ref(db, 'chats/'+k)); window.closeChatModal(); } 
                else { const h = Math.floor((diff % 86400000) / 3600000); cls.innerHTML = `Chat expiring in: ${h}h`; } 
            }; 
            updateTimer(); chatTimerInterval = setInterval(updateTimer, 60000); 
        } 
    }); 
    
    chatModal.style.display='flex'; 
    let isChatInit = true;
    onValue(ref(db, 'chats/'+k), s => { 
        const b = document.getElementById('chat-box'); if(!b) return; b.innerHTML=""; 
        const chatData = []; let newMsgFound = false;
        if(s.exists()) { s.forEach(c => { const m = c.val(); chatData.push(m); if (!isChatInit && m.s !== user.uid) newMsgFound = true; }); }
        if(newMsgFound) sndMsg.play().catch(()=>{}); isChatInit = false; 
        
        chatData.forEach(m => { 
            const isMe = (m.s === user.uid); let content = "";
            if(m.type === 'image') {
                content = `<img src="${m.file}" class="chat-img-preview" onclick="window.handleMediaClick('${m.file}', '${m.fileName || 'image.jpg'}', 'image')">`;
            } else if (m.type === 'file') {
                content = `<div style="display:flex;align-items:center;gap:10px;"><i class="fas fa-file-pdf" style="font-size:20px;color:#ef4444;"></i> <span style="font-size:12px;">${m.fileName || 'File'}</span></div>
                           <button class="chat-file-download" style="background:#2563eb;color:white;width:100%;margin-top:5px;" onclick="window.handleMediaClick('${m.file}', '${m.fileName || 'file'}', 'file')">View / Save</button>`;
            } else {
                content = `<span style="color:${isMe?'white':'var(--text)'};">${m.t || ""}</span>`;
            }
            b.innerHTML += `<div class="msg-row ${isMe?'me':'adm'}"><div class="msg ${isMe?'msg-me':'msg-adm'}">${content}</div></div>`; 
        }); 
        b.scrollTop = b.scrollHeight; 
    }); 
};

window.sendMsg = () => { const t = document.getElementById('chat-in').value; if(t && activeChat) { push(ref(db, 'chats/'+activeChat), {s:user.uid, t:t, type: 'text', timestamp: Date.now()}); document.getElementById('chat-in').value=""; } };
window.closeChatModal = () => { document.getElementById('chat-modal').style.display='none'; if (chatTimerInterval) clearInterval(chatTimerInterval); if(orderStatusListener) off(orderStatusListener); };

// --- IMAGE COMPRESSION UTIL ---
const processFile = (file) => {
    return new Promise((resolve, reject) => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image(); img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
                    const MAX_WIDTH = 1024; const MAX_HEIGHT = 1024;
                    let width = img.width; let height = img.height;
                    if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
                    else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
                    canvas.width = width; canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.7)); 
                };
            };
        } else {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
        }
    });
};

document.onkeydown = function(e) { if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) || (e.ctrlKey && e.keyCode === 85)) return false; };
document.querySelectorAll('img').forEach(img => { img.addEventListener('dragstart', e => e.preventDefault()); });
