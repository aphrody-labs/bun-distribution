/**
 * Configuration centralisée des icônes Rose Griffon
 * Garantit la cohérence visuelle dans toute l'application
 * Utilise lucide-react avec des tailles standardisées
 */

import type { LucideIcon } from "lucide-react";
import {
	Activity,
	// NOTE: Instagram, Twitter, Twitch, Youtube removed in lucide-react v1 — use shared/icons
	AlertCircle,
	AlertTriangle,
	Archive,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	ArrowUpDown,
	ArrowRight as ArrowUpRight,
	Award,
	BarChart3,
	// Actions & Status
	Bell,
	BellOff,
	Bot,
	Briefcase,
	// Association & Community
	Building,
	Calendar,
	CalendarDays,
	Camera,
	Check,
	CheckCircle,
	Check as CheckIcon,
	ChevronDown,
	ChevronDown as ChevronDownIcon,
	ChevronLeft,
	ChevronRight,
	ChevronRight as ChevronRightIcon,
	ChevronsUpDown,
	ChevronUp,
	ChevronUp as ChevronUpIcon,
	Circle as CircleIcon,
	Clapperboard,
	Clock,
	Construction,
	Copy,
	CreditCard,
	Database,
	Download,
	// Edit & Manage
	Edit,
	Edit2,
	ExternalLink,
	Eye,
	EyeOff,
	FileText,
	Filter,
	Folder,
	Gift,
	Globe,
	Handshake,
	Hash,
	Heart,
	// Navigation & Actions
	Home,
	ImageIcon,
	Image as ImageLucide,
	Info,
	LayoutGrid,
	List,
	Loader2,
	LogIn,
	LogOut,
	Mail,
	MapPin,
	Megaphone,
	Menu,
	MessageCircle,
	MessageSquare,
	Monitor,
	Moon,
	MoreHorizontal,
	Newspaper,
	Package,
	PackageOpen,
	Palette,
	PencilLine,
	PenSquare,
	Play,
	Plus,
	Radio,
	RefreshCw,
	RotateCw,
	Save,
	Scale,
	ScrollText,
	// Misc
	Search,
	// Admin & Settings
	Server,
	Settings,
	Share2,
	Shield,
	ShieldCheck,
	Swords,
	// Store & Commerce
	ShoppingBag,
	ShoppingCart,
	Smile,
	Sparkles,
	Sun,
	Tag,
	Trash,
	Trash2,
	Trophy,
	Tv,
	Upload,
	// User & Auth
	User,
	UserCheck,
	UserCircle,
	UserPlus,
	Users,
	Users2,
	UserX,
	Video,
	X,
	XCircle,
	X as XIcon,
	Zap,
} from "lucide-react";

import { InstagramIcon as Instagram } from "@/shared/icons/instagram";
import { TwitchIcon as Twitch } from "@/shared/icons/twitch";
import TwitterIcon from "@/shared/icons/twitter";
import { YoutubeIcon as Youtube } from "@/shared/icons/youtube";

const Twitter = TwitterIcon;

/**
 * Tailles standardisées pour les icônes
 */
export const iconSizes = {
	lg: "w-6 h-6",
	md: "w-5 h-5",
	responsive: "w-4 h-4 sm:w-[18px] sm:h-[18px]", // Standard pour sidebar
	responsiveLg: "w-5 h-5 sm:w-6 sm:h-6", // Pour headers
	sm: "w-4 h-4",
	xl: "w-8 h-8",
	xs: "w-3 h-3",
} as const;

/**
 * Configuration des icônes par catégorie
 */
export const icons = {
	// Navigation
	navigation: {
		back: ArrowLeft,
		chevronDown: ChevronDown,
		chevronRight: ChevronRight,
		close: X,
		externalLink: ExternalLink,
		forward: ArrowRight,
		home: Home,
		menu: Menu,
		scrollTop: ArrowUp,
		search: Search,
	},

	// User & Authentication
	user: {
		admin: ShieldCheck,
		login: LogIn,
		logout: LogOut,
		user: User,
		userCircle: UserCircle,
		userPlus: UserPlus,
		users: Users,
		usersGroup: Users2,
	},

	// Association
	association: {
		building: Building,
		calendar: CalendarDays,
		camera: Camera,
		charter: ScrollText,
		contact: PencilLine,
		location: MapPin,
		mail: Mail,
		partners: Handshake,
		support: Heart,
	},

	// Store
	store: {
		bag: ShoppingBag,
		cart: ShoppingCart,
		creditCard: CreditCard,
		package: Package,
		packageOpen: PackageOpen,
		tag: Tag,
	},

	// Admin
	admin: {
		analytics: BarChart3,
		database: Database,
		documents: FileText,
		images: ImageIcon,
		settings: Settings,
		shield: ShieldCheck,
	},

	// Status & Notifications
	status: {
		alert: AlertCircle,
		bell: Bell,
		check: Check,
		checkCircle: CheckCircle,
		info: Info,
		loading: Loader2,
		refresh: RefreshCw,
		rotate: RotateCw,
		warning: AlertTriangle,
	},

	// Actions
	actions: {
		add: Plus,
		archive: Archive,
		close: X,
		copy: Copy,
		delete: Trash2,
		download: Download,
		edit: Edit,
		upload: Upload,
	},

	// Theme
	theme: {
		moon: Moon,
		sun: Sun,
		system: Monitor,
	},

	// Social Media
	social: {
		globe: Globe,
		image: ImageLucide,
		instagram: Instagram,
		messageCircle: MessageCircle,
		newspaper: Newspaper,
		trophy: Trophy,
		tv: Tv,
		twitch: Twitch,
		twitter: Twitter,
		youtube: Youtube,
	},
} as const;

/**
 * Helper pour obtenir une icône avec la taille appropriée
 */
export function getIcon(
	category: keyof typeof icons,
	name: string,
	size: keyof typeof iconSizes = "responsive"
): { icon: LucideIcon; className: string } {
	const iconCategory = icons[category];
	if (!iconCategory) {
		console.warn(`Icon category "${category}" not found`);
		return { className: iconSizes[size], icon: AlertCircle };
	}

	const icon = (iconCategory as Record<string, LucideIcon>)[name];
	if (!icon) {
		console.warn(`Icon "${name}" not found in category "${category}"`);
		return { className: iconSizes[size], icon: AlertCircle };
	}

	return { className: iconSizes[size], icon };
}

/**
 * Props communes pour les icônes
 */
export const iconProps = {
	bold: {
		className: iconSizes.responsive,
		strokeWidth: 2.5,
	},
	default: {
		className: iconSizes.responsive,
		strokeWidth: 2,
	},
	thin: {
		className: iconSizes.responsive,
		strokeWidth: 1.5,
	},
} as const;

/**
 * Export des icônes les plus utilisées pour faciliter l'import
 */
// Export spécial pour Image (conflit avec Next.js Image)
export {
	// Admin
	Activity,
	// Status
	AlertCircle,
	AlertTriangle,
	Archive,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	ArrowUpDown,
	ArrowUpRight,
	Award,
	BarChart3,
	Bell,
	BellOff,
	Bot,
	Briefcase,
	// Association
	Building,
	Calendar,
	CalendarDays,
	Camera,
	Check,
	CheckCircle,
	// Aliases pour compatibilité
	CheckIcon,
	ChevronDown,
	ChevronDownIcon,
	ChevronLeft,
	ChevronRight,
	ChevronRightIcon,
	ChevronsUpDown,
	ChevronUp,
	ChevronUpIcon,
	CircleIcon,
	Clapperboard,
	Clock,
	Construction,
	Copy,
	CreditCard,
	Database,
	Download,
	// Actions
	Edit,
	Edit2,
	ExternalLink,
	Eye,
	EyeOff,
	FileText,
	Filter,
	Folder,
	Gift,
	Globe,
	Handshake,
	Hash,
	Heart,
	// Navigation
	Home,
	ImageIcon,
	ImageLucide as Image,
	Info,
	// Social & Media
	Instagram,
	LayoutGrid,
	List,
	Loader2,
	LogIn,
	LogOut,
	Mail,
	MapPin,
	Megaphone,
	Menu,
	MessageCircle,
	MessageSquare,
	Monitor,
	// Theme
	Moon,
	MoreHorizontal,
	Newspaper,
	Package,
	PackageOpen,
	Palette,
	PencilLine,
	PenSquare,
	Play,
	Plus,
	Radio,
	RefreshCw,
	RotateCw,
	Save,
	Scale,
	ScrollText,
	Search,
	// Admin
	Server,
	Settings,
	Share2,
	Shield,
	ShieldCheck,
	Swords,
	// Store
	ShoppingBag,
	ShoppingCart,
	Smile,
	Sparkles,
	Sun,
	Tag,
	Trash,
	Trash2,
	Trophy,
	Tv,
	Twitch,
	Twitter,
	Upload,
	// User
	User,
	UserCheck,
	UserCircle,
	UserPlus,
	Users,
	Users2,
	UserX,
	Video,
	X,
	XCircle,
	XIcon,
	Youtube,
	Zap,
};
