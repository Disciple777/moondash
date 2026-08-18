import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  BookOpen,
  Briefcase,
  Bug,
  Calendar,
  Camera,
  Clock,
  Cloud,
  Code,
  Coins,
  Coffee,
  Crown,
  Flag,
  Flame,
  FlaskConical,
  Folder,
  FolderArchive,
  FolderOpen,
  Gem,
  Ghost,
  Gift,
  Globe,
  Headphones,
  Heart,
  Home,
  Key,
  Layers,
  Leaf,
  Library,
  Lightbulb,
  Lock,
  Mail,
  MapPin,
  Moon,
  Music,
  Notebook,
  Palette,
  PawPrint,
  PencilLine,
  Pin,
  Pizza,
  Plane,
  Rocket,
  Shield,
  Smile,
  Sparkles,
  Star,
  Target,
  Zap
} from 'lucide-react'

/** Icon names offered in the folder picker (stored as `bit_folders.icon_key`). */
export const FOLDER_ICONS = [
  'Folder',
  'FolderOpen',
  'FolderArchive',
  'Star',
  'Heart',
  'Flag',
  'Rocket',
  'Zap',
  'Flame',
  'Sparkles',
  'Gem',
  'Camera',
  'Music',
  'Code',
  'Palette',
  'Globe',
  'Lock',
  'Shield',
  'Bell',
  'Mail',
  'Calendar',
  'Clock',
  'MapPin',
  'Coffee',
  'Gift',
  'Crown',
  'Key',
  'Lightbulb',
  'Cloud',
  'Moon',
  'Leaf',
  'PawPrint',
  'Bug',
  'Ghost',
  'Smile',
  'BookOpen',
  'Briefcase',
  'Plane',
  'Pizza',
  'Target',
  'FlaskConical',
  'Coins',
  'Headphones',
  'Home',
  'Library',
  'Pin',
  'Notebook',
  'Layers'
] as const

export const FOLDER_ICON_MAP: Record<string, LucideIcon> = {
  Folder,
  FolderOpen,
  FolderArchive,
  Star,
  Heart,
  Flag,
  Rocket,
  Zap,
  Flame,
  Sparkles,
  Gem,
  Camera,
  Music,
  Code,
  Palette,
  Globe,
  Lock,
  Shield,
  Bell,
  Mail,
  Calendar,
  Clock,
  MapPin,
  Coffee,
  Gift,
  Crown,
  Key,
  Lightbulb,
  Cloud,
  Moon,
  Leaf,
  PawPrint,
  Bug,
  Ghost,
  Smile,
  BookOpen,
  Briefcase,
  Plane,
  Pizza,
  Target,
  FlaskConical,
  Coins,
  Headphones,
  Home,
  Library,
  Pin,
  Notebook,
  PencilLine,
  Layers
}

/** Emojis stored by folders created before the switch to lucide icons. */
const LEGACY_EMOJI_ICONS: Record<string, string> = {
  '📁': 'Folder',
  '📂': 'FolderOpen',
  '🗂️': 'FolderArchive',
  '📒': 'Notebook',
  '📓': 'Notebook',
  '📝': 'PencilLine',
  '📌': 'Pin',
  '⭐': 'Star',
  '🔥': 'Flame',
  '🚀': 'Rocket',
  '💡': 'Lightbulb',
  '🎯': 'Target',
  '💼': 'Briefcase',
  '🎨': 'Palette',
  '🧪': 'FlaskConical',
  '📚': 'Library',
  '🏠': 'Home',
  '❤️': 'Heart',
  '🌿': 'Leaf',
  '🗓️': 'Calendar',
  '💰': 'Coins',
  '🎧': 'Headphones',
  '✈️': 'Plane',
  '🍕': 'Pizza'
}

/**
 * Resolve any stored icon key (lucide name, legacy emoji, or null) to a
 * valid lucide icon name, defaulting to 'Folder'.
 */
export function folderIconName(key: string | null | undefined): string {
  if (!key) return 'Folder'
  // Try the raw key first (some legacy emojis keep the U+FE0F variation
  // selector), then the normalized one, so both spellings resolve.
  const stripped = key.replace(/[\uFE0F\u200D]/g, '')
  const mapped = LEGACY_EMOJI_ICONS[key] ?? LEGACY_EMOJI_ICONS[stripped] ?? key
  return FOLDER_ICON_MAP[mapped] ? mapped : 'Folder'
}

export function FolderGlyph({
  iconKey,
  color,
  size = 14
}: {
  iconKey?: string | null
  color?: string
  size?: number
}) {
  const Icon = FOLDER_ICON_MAP[folderIconName(iconKey)]
  return <Icon size={size} style={color ? { color } : undefined} />
}
