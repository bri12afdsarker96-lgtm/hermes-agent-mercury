/**
 * Enterprise Console presentation layer — the approved "Visual Baseline v1"
 * design, implemented on the app's existing primitives.
 *
 * This barrel is also where the scoped stylesheet is pulled in, so anything
 * consuming a component from here gets the `--ec-*` layer with it and no call
 * site has to remember a separate CSS import.
 *
 * WHAT IS NOT HERE, AND WHY: Button, Input, Textarea, Select, SearchField,
 * SegmentedControl, Switch, Badge, Tabs, Skeleton, Loader, EmptyState,
 * ErrorState, Dialog, ConfirmDialog, Drawer (Sheet), DropdownMenu, Popover,
 * ScrollArea, Separator, Checkbox, Codicon, StatusDot, icons and cn all already
 * exist and are re-exported by `@hermes/plugin-sdk`. Import them from there.
 * A reuse census of the approved design's ~30 components found 27 of them
 * already had an owner in this app; only the three below did not. See
 * docs/enterprise-console/UI_REUSE_CENSUS.md for the file-by-file mapping.
 *
 * Toasts are `host.notify` / `host.notifyError`. Page and capability status
 * badges are the console's existing `status-badge.tsx`. Shell chrome —
 * titlebar, sidebar, statusbar — belongs to the host and is reached through its
 * contribution areas, never rebuilt.
 */

import './console.css'

export { DataTable, type DataTableColumn, type DataTableProps } from './data-table'
export { type KpiAccent, KpiCard, type KpiCardProps, type KpiDelta } from './kpi-card'
export { ConsolePanel, type ConsolePanelProps, PageHeader, type PageHeaderProps } from './panel'
export { Timeline, type TimelineEvent, type TimelineProps } from './timeline'
