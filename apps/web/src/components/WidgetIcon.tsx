import {
  Activity, BadgePlus, Bell, BarChart3, BatteryCharging, BookOpen, Bookmark, Calculator, CalendarDays, CalendarRange,
  Camera, ChefHat, CircleCheck, Clapperboard, Clock, Cloud, CloudSun, Container, Database, Disc, Download, Film,
  FolderOpen, Globe, Hand, HardDrive, Headphones, HeartPulse, House, Image, Inbox, KeyRound, Library, Link,
  Lock, Megaphone, MessageSquare, Monitor, Music, Newspaper, Play, Puzzle, Radio, RadioTower, RefreshCw, Repeat,
  Search, Shield, ShieldOff, Shuffle, StickyNote, Thermometer, Ticket, TrendingUp, Zap, LifeBuoy, ClipboardList,
  type LucideIcon,
} from "lucide-react";

/**
 * Los plugins declaran su icono como emoji (así no dependen de nada). Aquí se traducen a
 * iconos de línea, que se ven iguales en todos los sistemas y toman el color del tema.
 */
const MAP: Record<string, LucideIcon> = {
  "⬇": Download, "🛡": Shield, "📅": CalendarDays, "🕳": ShieldOff, "🔗": Link, "📥": Inbox, "🖥": Monitor,
  "🔎": Search, "📊": BarChart3, "📈": TrendingUp, "💽": HardDrive, "🆕": BadgePlus, "⚡": Zap, "☁": Cloud,
  "🧮": Calculator, "🧩": Puzzle, "🟢": CircleCheck, "🛟": LifeBuoy, "🚦": Activity, "🗼": RadioTower,
  "🗓": CalendarRange, "🗄": Database, "🗂": FolderOpen, "🖼": Image, "🕐": Clock, "🔖": Bookmark, "🔔": Bell,
  "🔒": Lock, "🔐": KeyRound, "🔋": BatteryCharging, "🔄": RefreshCw, "🔁": Repeat, "🔀": Shuffle,
  "📸": Camera, "📷": Camera, "📰": Newspaper, "📣": Megaphone, "📡": Radio, "📝": StickyNote, "📚": Library,
  "📖": BookOpen, "📋": ClipboardList, "💿": Disc, "💬": MessageSquare, "💓": HeartPulse, "👋": Hand,
  "🐳": Container, "🏡": House, "🏠": House, "🎵": Music, "🎬": Clapperboard, "🎧": Headphones, "🎟": Ticket,
  "🎞": Film, "🍳": ChefHat, "🌡": Thermometer, "🌐": Globe, "✅": CircleCheck, "⛅": CloudSun, "▶": Play,
};

/** Icono de un widget del catálogo (a partir de su emoji). */
export function WidgetIcon({ emoji, size = 18, className }: { emoji?: string; size?: number; className?: string }) {
  const key = (emoji ?? "").replace(/\uFE0F/g, "");
  const Icon = MAP[key] ?? Puzzle;
  return <Icon size={size} strokeWidth={1.75} className={className} aria-hidden />;
}
