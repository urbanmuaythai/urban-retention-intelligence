// "Download app" button: uses the browser's install prompt where offered,
// otherwise shows the steps for adding Member Care to the home screen.
let deferredPrompt = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    document.querySelectorAll(".install-app").forEach((b) => b.remove());
  });
}

export function isInstalled() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export function installButton(icon, extraClass = "") {
  if (isInstalled()) return "";
  return `<button class="button secondary install-app ${extraClass}" type="button">${icon("download")} Download app</button>`;
}

function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

const STEPS = {
  ios: [
    "Open this page in <strong>Safari</strong>.",
    "Tap the <strong>Share</strong> button (square with an arrow).",
    "Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.",
  ],
  android: [
    "Open this page in <strong>Chrome</strong>.",
    "Tap the <strong>⋮</strong> menu in the top corner.",
    "Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.",
  ],
  desktop: [
    "Open this page in <strong>Chrome</strong> or <strong>Edge</strong>.",
    "Click the <strong>install</strong> icon at the right of the address bar, or open the browser menu.",
    "Choose <strong>Install Urban Muaythai Member Care</strong>.",
  ],
};

function showSteps(icon, decorate) {
  let dialog = document.querySelector("#install-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "install-dialog";
    dialog.className = "install-dialog";
    dialog.setAttribute("aria-labelledby", "install-title");
    document.body.append(dialog);
  }
  const steps = STEPS[platform()];
  dialog.innerHTML = `<div class="install-card"><button class="icon-button install-close" type="button" aria-label="Close">${icon("x")}</button><div class="eyebrow">URBAN MUAYTHAI MEMBER CARE</div><h2 id="install-title">Download the app</h2><p>Add Member Care to your home screen so it opens full screen like a normal app.</p><ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol><button class="button primary install-done" type="button">Got it</button></div>`;
  decorate();
  dialog.querySelector(".install-close").onclick = () => dialog.close();
  dialog.querySelector(".install-done").onclick = () => dialog.close();
  dialog.onclick = (e) => e.target === dialog && dialog.close();
  dialog.showModal();
}

export function bindInstall(icon, decorate) {
  document.querySelectorAll(".install-app").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!deferredPrompt) return showSteps(icon, decorate);
        const prompt = deferredPrompt;
        deferredPrompt = null;
        prompt.prompt();
        await prompt.userChoice.catch(() => null);
      }),
  );
}
