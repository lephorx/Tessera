export type Design = "modern" | "classic"

export const DESIGN_KEY = "cscm-design"

/** runs in <head> before React, so the page never flashes the other look */
export const DESIGN_BOOT_SCRIPT = `(function(){try{
var r=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)");
function a(){var d=localStorage.getItem("${DESIGN_KEY}")==="classic"?"classic":"modern";
var dark=d==="classic"||m.matches;r.dataset.design=d;r.classList.toggle("dark",dark);
r.style.colorScheme=dark?"dark":"light"}
a();m.addEventListener("change",a);window.__cscmApplyDesign=a;
}catch(e){}})()`
