import type { SvgIconComponent } from '@mui/icons-material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import DataObjectIcon from '@mui/icons-material/DataObject';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlineOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import ToggleOnOutlinedIcon from '@mui/icons-material/ToggleOnOutlined';

// Keyed by CFEngine promise type (the same string primaryPromiseType()
// returns), not by block id — every block of a given promise type shares
// one icon, matching the badge shown on the same card.
export const PROMISE_TYPE_ICONS: Record<string, SvgIconComponent> = {
  vars: DataObjectIcon,
  classes: ToggleOnOutlinedIcon,
  files: DescriptionOutlinedIcon,
  packages: Inventory2OutlinedIcon,
  services: SettingsOutlinedIcon,
  users: PersonOutlineIcon,
  storage: StorageOutlinedIcon,
  reports: ArticleOutlinedIcon,
  commands: TerminalIcon,
  processes: MemoryOutlinedIcon,
  methods: AccountTreeOutlinedIcon
};
