// Đọc cấu hình SEO / theo dõi từ site_settings (công khai). Mọi giá trị được KIỂM LẠI định dạng ở đây (ngoài trigger trong DB)
// vì chúng được chèn vào mọi trang: mã GTM = chạy script bên thứ ba, nên giá trị sai bị bỏ qua thay vì chèn.
const RE = {
  ga4: /^G-[A-Z0-9]{6,12}$/, gtm: /^GTM-[A-Z0-9]{4,10}$/, verify: /^[A-Za-z0-9_-]{10,100}$/,
  path: /^[A-Za-z0-9._/-]{1,200}$/, host: /^https:\/\/[a-z0-9*.-]+(:[0-9]{1,5})?$/, social: /^https:\/\/[^\s<>"']{4,300}$/
};
const str = (v) => (typeof v === "string" ? v.trim() : "");
const hosts = (v) => str(v).split(/\s+/).filter((h) => RE.host.test(h));
const SOCIAL = [["social_facebook", "Facebook"], ["social_zalo", "Zalo"], ["social_youtube", "YouTube"], ["social_tiktok", "TikTok"], ["social_linkedin", "LinkedIn"]];

export function siteCfg(s, lang, name) {
  const ga4 = RE.ga4.test(str(s.ga4_id)) ? str(s.ga4_id) : "", gtm = RE.gtm.test(str(s.gtm_id)) ? str(s.gtm_id) : "";
  const pth = (k) => (RE.path.test(str(s[k])) && !str(s[k]).includes("..") ? str(s[k]) : "");
  return {
    noindex: s.seo_noindex === true,
    titleSuffix: str(s.seo_title_suffix).slice(0, 100) || name,
    homeTitle: str(s["seo_home_title_" + lang]).slice(0, 200), homeDesc: str(s["seo_home_desc_" + lang]).slice(0, 300),
    ogImage: pth("seo_og_image"), logo: pth("brand_logo_path"), favicon: pth("brand_favicon_path"),
    verifyGoogle: RE.verify.test(str(s.seo_verification_google)) ? str(s.seo_verification_google) : "",
    verifyBing: RE.verify.test(str(s.seo_verification_bing)) ? str(s.seo_verification_bing) : "",
    social: SOCIAL.map(([k, label]) => [label, str(s[k])]).filter(([, u]) => RE.social.test(u)),
    // GTM được ưu tiên: nếu cấu hình cả hai thì chỉ dùng GTM (tránh đếm trùng sự kiện)
    ga4: gtm ? "" : ga4, gtm, consent: s.tracking_consent === "none" ? "none" : "required",
    csp: { script: hosts(s.csp_script_extra), connect: hosts(s.csp_connect_extra), img: hosts(s.csp_img_extra), frame: hosts(s.csp_frame_extra) }
  };
}

export function buildCsp(cfg) {
  const track = !!(cfg.ga4 || cfg.gtm);
  const script = ["'self'", "https://challenges.cloudflare.com", ...(track ? ["https://www.googletagmanager.com", "https://www.google-analytics.com"] : []), ...cfg.csp.script];
  const connect = ["'self'", ...(track ? ["https://www.google-analytics.com", "https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com", "https://stats.g.doubleclick.net"] : []), ...cfg.csp.connect];
  const img = ["'self'", "data:", "https://*.supabase.co", ...(track ? ["https://www.google-analytics.com", "https://*.google-analytics.com", "https://www.googletagmanager.com"] : []), ...cfg.csp.img];
  const frame = ["https://challenges.cloudflare.com", ...cfg.csp.frame];
  const j = (a) => [...new Set(a)].join(" ");
  return `default-src 'self'; script-src ${j(script)}; style-src 'self'; img-src ${j(img)}; connect-src ${j(connect)}; frame-src ${j(frame)}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
}
