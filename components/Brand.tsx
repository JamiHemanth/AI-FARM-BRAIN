import { Sprout } from "lucide-react";
export function Brand({ light = false }: { light?: boolean }) { return <div className="brand" style={light ? { color: "white" } : undefined}><span className="brand-mark"><Sprout size={21}/></span><span>FarmBrain</span></div>; }
