import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, runTransaction, off, query, orderByChild, equalTo, onChildChanged, remove } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

// --- LOAD PDF ENGINE ---
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
    .viewer-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%; }
    .viewer-close { background: rgba(255,255,255,0.1); width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px; }
    .viewer-body { flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 10px; background: #000; position: relative; }
    .media-content { max-width: 100%; height: auto; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
    #pdf-canvas { direction: ltr; background: white; margin-bottom: 100px; max-width: 100%; box-shadow: 0 0 15px rgba(0,0,0,0.5); }
    
    .viewer-controls { position: fixed; bottom: 0; left: 0; width: 100%; background: #1e293b; padding: 15px 10px; display: grid; grid-template-columns: 1fr 3fr 1fr; gap: 10px; border-top: 1px solid #334155; z-index: 100000; padding-bottom: max(15px, env(safe-area-inset-bottom)); }
    .ctrl-btn { background: #334155; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 16px; }
    .ctrl-btn span { font-size: 10px; opacity: 0.8; }
    .ctrl-btn.primary { background: #2563eb; color: white; font-weight: bold; background: linear-gradient(135deg, #2563eb, #1d4ed8); }
    .ctrl-btn.secondary { background: #0f172a; border: 1px solid #334155; }
    
    .pdf-nav { position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%); background: rgba(30, 41, 59, 0.9); padding: 8px 15px; border-radius: 30px; display: none; gap: 15px; align-items: center; color: white; font-size: 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); z-index: 100000; }
    .nav-btn { background: none; border: none; color: white; font-size: 16px; cursor: pointer; }
    .loading-spinner { border: 4px solid rgba(255,255,255,0.1); border-top: 4px solid #3b82f6; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; position: absolute; top: 50%; left: 50%; margin-left: -20px; margin-top: -20px; }
    
    /* Progress Bar */
    .upload-progress { position: absolute; bottom: 0; left: 0; height: 4px; background: #10b981; width: 0%; transition: width 0.3s; z-index: 100002; }
`;
document.head.appendChild(viewerStyle);

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
    if(!container) { container = document.createElement('div'); container.id = 'toast-container'; container.className = 'toast-container'; document.body.appendChild(container); }
    const toast = document.createElement('div'); toast.className = `premium-toast ${isError ? 'error' : 'success'}`;
    const icon = isError ? '<i class="fas fa-times-circle"></i>' : '<i class="fas fa-check-circle"></i>';
    toast.innerHTML = `<div class="p-toast-icon">${icon}</div><div class="p-toast-content"><h4>${title}</h4><p>${msg}</p></div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.transition = "all 0.5s ease"; toast.style.opacity = '0'; toast.style.transform = 'translateY(-20px)'; setTimeout(() => toast.remove(), 500); }, 3500);
};

// --- COPY ---
window.copyText = (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => window.showPremiumAlert("Copied! 📋", "Text copied.")).catch(err => fallbackCopyText(text));
    } else fallbackCopyText(text);
};
function fallbackCopyText(text) {
    const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.focus(); t.select();
    try { document.execCommand('copy'); window.showPremiumAlert("Copied! 📋", "Text copied."); } catch (err) {} document.body.removeChild(t);
}

// ===============================================
// --- SERVER UPLOAD & DOWNLOAD SYSTEM ---
// ===============================================

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

window.uploadAndDownload = async (base64Data, fileName, isImage) => {
    const btn = document.getElementById('server-dl-btn');
    const originalContent = btn.innerHTML;
    const progress = document.getElementById('upload-bar');
    
    // 1. Prepare File
    const blob = base64ToBlob(base64Data);
    if (!blob) return window.showPremiumAlert("Error", "File corrupted.", true);
    
    const safeName = fileName ? fileName.replace(/[^a-zA-Z0-9.]/g, '_') : `file_${Date.now()}.${isImage ? 'jpg' : 'pdf'}`;
    const formData = new FormData();
    formData.append('file', blob, safeName);
    
    // 2. Upload to Server (File.io - Free, No Auth, Expires after download)
    // Note: We use file.io because it allows CORS and returns a direct link.
    // Ideally, you should use your own backend or Firebase Storage for permanent storage.
    
    try {
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i><span>UPLOADING...</span>`;
        progress.style.width = "50%";

        const response = await fetch('https://file.io/?expires=1d', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error("Upload failed");
        
        const data = await response.json();
        progress.style.width = "100%";
        
        if (data.success && data.link) {
            btn.innerHTML = `<i class="fas fa-check"></i><span>OPENING...</span>`;
            window.showPremiumAlert("Success", "File link generated!", false);
            
            // 3. Open the Generated Link
            // This works in Telegram because it's a standard HTTPS link, not a blob.
            setTimeout(() => {
                window.open(data.link, '_system'); // '_system' helps in some WebViews
            }, 500);
        } else {
            throw new Error("Server error");
        }

    } catch (e) {
        console.error(e);
        window.showPremiumAlert("Upload Error", "Could not generate link.", true);
    } finally {
        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.disabled = false;
            progress.style.width = "0%";
        }, 2000);
    }
};

// --- VIEWER ---
window.handleMediaClick = async (base64Data, fileName, type) => {
    const overlay = document.createElement('div');
    overlay.className = 'media-overlay';
    
    let isImage = type === 'image' || (fileName && fileName.match(/\.(jpeg|jpg|png|gif)$/i));
    
    overlay.innerHTML = `
        <div class="viewer-header">
            <div class="viewer-title">${fileName || 'File Viewer'}</div>
            <div class="viewer-close" id="close-viewer">✕</div>
        </div>
        <div class="viewer-body" id="viewer-body">
            <div class="loading-spinner" id="spinner"></div>
        </div>
        
        <!-- Progress Bar for Upload -->
        <div class="upload-progress" id="upload-bar"></div>

        <div class="pdf-nav" id="pdf-nav">
            <button class="nav-btn" id="prev-page"><i class="fas fa-chevron-left"></i></button>
            <span id="page-num">1 / 1</span>
            <button class="nav-btn" id="next-page"><i class="fas fa-chevron-right"></i></button>
        </div>

        <div class="viewer-controls">
            <button class="ctrl-btn secondary" id="zoom-toggle"><i class="fas fa-search-plus"></i></button>
            
            <!-- MAIN SERVER UPLOAD BUTTON -->
            <button class="ctrl-btn primary" id="server-dl-btn">
                <i class="fas fa-cloud-download-alt"></i><span>GET LINK</span>
            </button>
            
            <button class="ctrl-btn secondary" id="force-share"><i class="fas fa-share-alt"></i></button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    document.getElementById('close-viewer').onclick = () => { overlay.remove(); };

    const body = document.getElementById('viewer-body');
    const spinner = document.getElementById('spinner');
    let scale = 1;

    if (isImage) {
        spinner.style.display = 'none';
        const img = document.createElement('img');
        img.src = base64Data;
        img.className = 'media-content';
        body.appendChild(img);
        document.getElementById('zoom-toggle').onclick = () => { scale = (scale === 1) ? 2 : 1; img.style.transform = `scale(${scale})`; img.style.transition="0.3s"; };
    } else {
        let pdfDoc=null, canvas=document.createElement('canvas'), ctx=canvas.getContext('2d'), pageNum=1;
        canvas.id='pdf-canvas'; body.appendChild(canvas);
        const pdfNav = document.getElementById('pdf-nav');

        try {
            const pdfData = atob(base64Data.split(',')[1]);
            if(typeof pdfjsLib === 'undefined') throw new Error("Loading PDF Engine...");
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

            document.getElementById('prev-page').onclick = () => { if(pageNum>1) { pageNum--; renderPage(pageNum); } };
            document.getElementById('next-page').onclick = () => { if(pageNum<pdfDoc.numPages) { pageNum++; renderPage(pageNum); } };
            document.getElementById('zoom-toggle').onclick = () => { scale = (scale===1.0)?1.5:1.0; renderPage(pageNum); };
        } catch(e) {
            spinner.style.display='none'; body.innerHTML=`<p style="color:#ef4444;text-align:center;margin-top:50px;">Use Download Button</p>`;
        }
    }

    // --- ACTION: UPLOAD TO SERVER & GET LINK ---
    document.getElementById('server-dl-btn').onclick = () => {
        window.uploadAndDownload(base64Data, fileName, isImage);
    };

    // --- ACTION: FORCE SHARE (Backup) ---
    document.getElementById('force-share').onclick = () => {
        const blob = base64ToBlob(base64Data);
        if(!blob) return;
        const fileObj = new File([blob], fileName || "file", { type: blob.type });
        if(navigator.share && navigator.canShare({ files: [fileObj] })) {
            navigator.share({ files: [fileObj], title: fileName });
        } else {
            window.showPremiumAlert("Share Error", "Use the 'Get Link' button.", true);
        }
    };
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
                    const MAX_WIDTH = 1024; const MAX_HEIGHT = 1024;
                    let width = img.width; let height = img.height;
                    if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
                    else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
                    canvas.width = width; canvas.height = height;
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
            let isExpired = false; 
            if(v.status === 'completed' && v.completed_at) { 
                if((Date.now() - v.completed_at) > 43200000) isExpired = true; 
            }
            let chatBtn = (!isExpired && v.status !== 'cancelled') ? `<button class="chat-btn-small" onclick="window.openChat('${v.key}', '${v.orderId_visible}')"><i class="fas fa-comments"></i></button>` : '';
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

// --- CHAT LOGIC ---
window.openChat = (k, id) => { 
    const chatModal = document.getElementById('chat-modal'); if(!chatModal) return;
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
        if (data.status === 'completed' && data.completed_at) {
            const timePassed = Date.now() - data.completed_at;
            if (timePassed > EXPIRY_TIME_MS) {
                remove(ref(db, 'chats/'+k)); window.closeChatModal(); window.showPremiumAlert("Chat Expired", "12 hours passed. Chat is now closed.", true); return;
            }
        }
        if (data.status === 'pending') { inp.style.display = 'flex'; cls.style.display = 'none'; } 
        else if (data.status === 'processing') { inp.style.display = 'none'; cls.style.display = 'block'; cls.className = 'chat-closed-ui processing'; cls.innerHTML = '<i class="fas fa-lock"></i> অর্ডার প্রসেসিং এ আছে। চ্যাট বন্ধ।'; } 
        else if (data.status === 'completed') { 
            inp.style.display = 'none'; cls.style.display = 'block'; cls.className = 'chat-closed-ui'; 
            const updateTimer = () => { 
                const diff = EXPIRY_TIME_MS - (Date.now() - (data.completed_at || 0)); 
                if (diff <= 0) { clearInterval(chatTimerInterval); remove(ref(db, 'chats/'+k)); window.closeChatModal(); window.showPremiumAlert("Chat Expired", "Time limit reached.", true); } 
                else { const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)); const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)); cls.innerHTML = `<i class="fas fa-history"></i> Chat expiring in: ${h}h ${m}m`; } 
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
            
            // --- UPDATED MEDIA RENDERING ---
            if(m.type === 'image') {
                content = `
                    <img src="${m.file}" class="chat-img-preview" onclick="window.handleMediaClick('${m.file}', '${m.fileName || 'image.jpg'}', 'image')"><br>
                    <button class="chat-file-download" style="background:rgba(255,255,255,0.2); width:100%; justify-content:center;" onclick="window.handleMediaClick('${m.file}', '${m.fileName || 'image.jpg'}', 'image')">
                        <i class="fas fa-expand"></i> View
                    </button>`;
            } else if (m.type === 'file') {
                let isPdf = m.file.includes('application/pdf');
                let iconClass = isPdf ? "fa-file-pdf" : "fa-file";
                let iconColor = isPdf ? "#ef4444" : "var(--text)";
                content = `
                    <div style="display:flex;align-items:center;gap:10px; margin-bottom:6px;">
                        <i class="fas ${iconClass}" style="font-size:24px; color:${iconColor};"></i> 
                        <span style="font-size:12px; font-weight:600;">${m.fileName || 'Document'}</span>
                    </div>
                    <button class="chat-file-download" style="background:#2563eb; color:white; width:100%; justify-content:center;" onclick="window.handleMediaClick('${m.file}', '${m.fileName || 'file'}', 'file')">
                        <i class="fas fa-eye"></i> View File
                    </button>`;
            } else {
                const linkify = (text) => { const urlRegex = /(https?:\/\/[^\s]+)/g; return text.replace(urlRegex, function(url) { return `<a href="${url}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="color:inherit; text-decoration:underline; font-weight:bold; word-break: break-all;">${url}</a>`; }); };
                content = `<span style="color:${isMe ? 'white' : 'var(--text)'}; display:block;">${linkify(m.t || "")}</span>`;
            }
            b.innerHTML += `<div class="msg-row ${isMe?'me':'adm'}"><div class="msg ${isMe?'msg-me':'msg-adm'}">${content}</div></div>`; 
        }); 
        b.scrollTop = b.scrollHeight; 
    }); 
};

window.sendMsg = () => { const t = document.getElementById('chat-in').value; if(t && activeChat) { push(ref(db, 'chats/'+activeChat), {s:user.uid, t:t, type: 'text', timestamp: Date.now()}); document.getElementById('chat-in').value=""; } };
window.closeChatModal = () => { document.getElementById('chat-modal').style.display='none'; if (chatTimerInterval) clearInterval(chatTimerInterval); if(orderStatusListener) off(orderStatusListener); };

// ================= SECURITY MODULE =================
document.onkeydown = function(e) { if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) || (e.ctrlKey && e.keyCode === 85)) return false; };
document.querySelectorAll('img').forEach(img => { img.addEventListener('dragstart', e => e.preventDefault()); });
