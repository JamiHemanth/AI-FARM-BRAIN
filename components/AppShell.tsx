"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Bot, CalendarCheck, LayoutDashboard, LogOut, Plus, Settings, Sprout, Store, Users, type LucideIcon } from "lucide-react";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { languages, useI18n } from "@/lib/i18n";

export type FarmSummary={id:string;name:string;type:string;crops:{crop:{name:string};stage:{name:string}}[]};
export function AppShell({children,farms=[],selectedFarmId,user}:{children:React.ReactNode;farms?:FarmSummary[];selectedFarmId?:string;user?:{name:string;role:string}}){
 const {language,setLanguage,t,tx}=useI18n();
 const path=usePathname(),router=useRouter(); const links:Array<[string,string,LucideIcon]>=[
  ["/dashboard","Overview",LayoutDashboard],["/farms","My farms",Sprout],["/services","Services",Store],["/bookings","Bookings",CalendarCheck],["/ai-assistant","Ask AI",Bot]
 ];
 if(user?.role==="PROVIDER") links.push(["/provider/dashboard","Provider",Users]); if(user?.role==="WORKER") links.push(["/worker/dashboard","Worker",Users]); if(user?.role==="ADMIN") links.push(["/admin/dashboard","Admin",Settings]);
 async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.push("/auth/login");router.refresh()}
 function switchFarm(id:string){const section=path.match(/\/farms\/[^/]+\/(.+)/)?.[1]||"";router.push(`/farms/${id}${section?`/${section}`:""}`)}
 return <div className="app-shell"><aside className="sidebar"><Link href="/dashboard"><Brand light/></Link><nav className="nav-list">{links.map(([href,label,Icon])=><Link key={href} href={href} className={`nav-link ${path===href||path.startsWith(href+"/")?"active":""}`}><Icon size={19}/><span>{t(label)}</span></Link>)}</nav><div className="sidebar-foot"><b>{user?.name||"Farmer"}</b><br/>{tx(user?.role?.toLowerCase()||"farm member")}<button className="sidebar-logout" onClick={logout}><LogOut size={14}/> {t("Sign out")}</button></div></aside><main className="main"><header className="topbar"><div>{farms.length?<select aria-label="Current farm" className="farm-select" value={selectedFarmId||""} onChange={e=>switchFarm(e.target.value)}><option value="" disabled>{t("Choose current farm")}</option>{farms.map(f=><option value={f.id} key={f.id}>{tx(f.name)}</option>)}</select>:<Link className="btn btn-accent" href="/farms/new"><Plus size={16}/> {t("Add first farm")}</Link>}</div><div className="top-actions"><label className="language-picker"><span>{t("Language")}</span><select value={language} onChange={e=>setLanguage(e.target.value as typeof language)}>{languages.map(l=><option key={l.code} value={l.code}>{l.native}</option>)}</select></label><span className="secure-pill">SECURE</span><ThemeToggle/><Link href="/notifications" className="btn btn-ghost icon-btn" aria-label={t("Notifications")}><Bell size={18}/></Link><button className="btn btn-ghost logout-top" onClick={logout}><LogOut size={16}/><span>{t("Logout")}</span></button><span className="avatar">{user?.name?.[0]||"F"}</span></div></header>{children}</main></div>
}
