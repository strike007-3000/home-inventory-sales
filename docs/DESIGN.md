---
name: Home Inventory
description: A calm, familiar working surface for everyday sales and stock care.
colors:
  action-blue: "#1468e8"
  action-blue-dark: "#0e56c3"
  action-blue-soft: "#eaf2ff"
  canvas-cool-grey: "#f6f7f9"
  surface-white: "#ffffff"
  surface-subtle: "#f9fafb"
  ink: "#17191d"
  muted-ink: "#646a73"
  hairline: "#e3e6ea"
  hairline-strong: "#d2d7de"
  success-green: "#147a52"
  success-soft: "#e9f7f1"
  warning-amber: "#946200"
  warning-soft: "#fff5d9"
  danger-red: "#b42318"
  danger-soft: "#fff0ee"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  sm: "8px"
  control: "10px"
  surface: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "32px"
  3xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-dark}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "48px"
  input:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
    height: "48px"
  card:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "17px 18px"
  status-chip:
    rounded: "{rounded.pill}"
    padding: "3px 9px"
    height: "26px"
---

# Design System: Home Inventory

> Current design reference for the hosted application. Historical prototype language elsewhere in this file describes the visual origin, not the runtime or data architecture.

## Overview

**Creative North Star: "The Clear Counter"**

Home Inventory should feel like a clear, well-kept counter where one routine job is easy to see and finish. It is a calm working surface, not a decorative dashboard: white and cool-grey layers, dark ink, hairline dividers, consistent line icons, and generous breathing room keep attention on sales and stock.

The interface uses familiar app conventions without generic SaaS chrome. Plain labels, reachable primary actions, and stable navigation let older, nontechnical users move confidently between Home, Sell, Products, and Stock. Information density stays moderate; operational detail appears when the task needs it, not as decoration.

**Key Characteristics:**

- Light, quiet surfaces with crisp ink hierarchy.
- One strong blue reserved for actions, selection, focus, and active navigation.
- Familiar boxed Home summaries, with lists and bordered cards for operational content.
- Simple 2px line icons paired with text for primary actions.
- Responsive bottom navigation on phones and a persistent rail on desktop.
- Minimum 48px standard controls, visible focus, and plain nontechnical language.

## Colors

The palette is cool, restrained, and functional: blue directs action, while green, amber, and red appear only when a status needs meaning.

### Primary

- **Clear Action Blue:** The only strong interface accent; use for primary buttons, active navigation, selected controls, quantity actions, and focus borders.
- **Deep Action Blue:** The pressed or hover partner for primary blue and legible text on pale blue selection surfaces.
- **Blue Wash:** A quiet selection and icon background that signals action without creating another loud surface.

### Neutral

- **Cool Canvas:** The application background behind working surfaces.
- **Counter White:** Cards, navigation, fields, and fixed action bars.
- **Quiet Surface:** Hover fills and small inset information areas.
- **Working Ink:** Primary copy, values, and headings.
- **Supporting Ink:** Secondary labels, hints, inactive navigation, and metadata.
- **Hairline / Strong Hairline:** Structure cards, lists, controls, and navigation without adding visual weight.
- **Success Green / Soft Success:** Completed outcomes and positive stock changes.
- **Warning Amber / Soft Warning:** Low-stock guidance and cautionary status.
- **Danger Red / Soft Danger:** Destructive actions, errors, and out-of-stock states.

**The One Blue Rule.** Blue is the sole general-purpose accent. Green, amber, and red communicate status only; they never compete for routine action hierarchy.

**The White Is a Surface Rule.** The cool canvas frames the application; white marks an interactive or contained working surface rather than becoming an ornamental tile mosaic.

## Typography

**Display Font:** Inter (with system sans-serif fallback)  
**Body Font:** Inter (with system sans-serif fallback)  
**Label/Mono Font:** System monospace for SKUs and codes only

**Character:** A single modern sans-serif keeps the product direct and familiar. Weight and spacing establish hierarchy; typography should never become expressive enough to distract from the task.

### Hierarchy

- **Headline:** Bold and compact; used for page and result titles.
- **Title:** Bold; used for section headings and strong card labels.
- **Body:** Regular, comfortably spaced, and never smaller than 16px for primary reading or input text.
- **Label:** Bold and concise; used above controls and on buttons.
- **Supporting text:** Smaller type is limited to metadata, hints, status chips, and navigation labels.
- **Numeric values:** Use tabular numerals for prices, quantities, and summaries so changing values remain easy to compare.

**The Plain Voice Rule.** Prefer short, familiar words and sentence case. Do not introduce warehouse, accounting, or software terminology when home-business language is available.

## Layout

The layout follows a single centered work column on phones and tablets, then expands to a wider desktop workspace beside a persistent navigation rail. Mobile content uses 18px side padding; tablet content uses 28px; desktop content uses 48px inside a workspace capped at 1060px. The default reading column remains capped at 760px.

Phone navigation is a fixed four-item bottom bar with icon-and-text labels. At 1024px it becomes a 236px left rail, and fixed primary actions move from immediately above the bottom bar to the lower edge of the desktop workspace. At 700px, headers may place a bounded primary action beside the title. Touch controls remain at least 48px high, with 44px reserved only for compact secondary controls.

Use the 4px-based spacing scale. Group related labels and controls tightly, separate sections with 20–32px of space, and let hairline dividers carry structure inside lists. Product cards become task-oriented rows on desktop rather than simply stretching wider.

**The Reachable Action Rule.** The primary completion action stays visible near the user's thumb on phones and at the working edge of the desktop canvas.

**The Familiar Home Exception.** Keep the current boxed Today and Stock alerts summaries on Home. They are an intentionally familiar overview pattern, not permission to turn other screens into dashboard grids.

## Elevation & Depth

The system is flat by default and uses no ambient card shadows. Depth comes from white-on-grey tonal layering, 1px borders, fixed navigation and action surfaces, and restrained inset focus treatment. A subtle blue focus halo belongs to interaction feedback, not decoration.

**The Hairline Before Shadow Rule.** Use a divider, border, or tonal shift to separate working regions. Do not add drop shadows to cards or navigation simply to make them feel more prominent.

## Shapes

Forms are gently rounded and practical. Standard controls use 10px corners, cards use 12px, large containers may use 16px, and compact status chips use a full pill. Borders remain thin and cool grey. Circular silhouettes are reserved for result icons; irregular decorative shapes do not belong in the product.

Line icons use a consistent 24px view box, round caps and joins, and an approximately 2px stroke. Their geometry should remain simple enough to recognize at navigation size.

## Components

### Buttons

Buttons feel dependable and explicit rather than promotional.

- **Shape:** Gently rounded controls with a 10px radius and a 48px minimum height; large task actions reach 54px.
- **Primary:** Solid action blue with white bold text; full width on compact screens and bounded where space permits.
- **Hover / Focus:** Darken blue and lift by 1px on hover; return to rest on press; use the shared visible blue focus outline. Reduced-motion preference removes meaningful transition duration.
- **Secondary:** White with a strong hairline border and dark ink.
- **Ghost:** Transparent with muted text, reserved for low-priority actions.
- **Danger:** Solid danger red with white text, used only for destructive confirmation.

### Chips

- **Style:** Fully rounded, compact status labels with a pale semantic background and dark semantic text.
- **State:** Use only for meaningful success, warning, or error status—not as decorative tags or navigation.

### Cards / Containers

- **Corner Style:** 12px corners with a thin hairline border.
- **Background:** Counter white on the cool canvas.
- **Shadow Strategy:** Flat; no card shadow.
- **Internal Padding:** 17–20px depending on viewport.
- **Behavior:** Clickable cards shift to the quiet surface and strengthen their border. Home summary cards remain boxed by explicit user choice; operational lists may use dividers instead.

### Inputs / Fields

- **Style:** White field, strong hairline border, 10px radius, and at least 48px height.
- **Focus:** Action-blue border plus a restrained translucent blue halo.
- **Error / Disabled:** Error copy uses danger red; disabled controls retain their form but lower opacity and remove the pointer affordance.
- **Search:** Place a muted 20px line icon inside the left edge and preserve comfortable text inset.

### Navigation

Navigation is stable, labeled, and always available. Phone navigation uses a fixed white bottom bar with four equal items; the active item uses action blue and a short top indicator. Desktop navigation becomes a fixed white left rail; the active row uses blue wash with deep blue text. Every icon is accompanied by a text label.

### Quantity Stepper

The quantity stepper is a bordered three-part control with 48px decrement and increment targets, a tabular centered value, and pale neutral button surfaces. Available actions use blue; unavailable actions become muted. Keep the control visibly connected to its product and show a plain-language availability hint when the maximum is reached.

### Sticky Action Bar

Use a nearly opaque white fixed bar with a hairline top border for the current task's main action. It sits above phone navigation and aligns with the desktop workspace beside the rail. Do not place competing primary actions inside it.

## Do's and Don'ts

### Do:

- **Do** make the next routine action unmistakable with one blue primary control.
- **Do** retain the familiar boxed Home summaries for Today and Stock alerts.
- **Do** use bordered cards for contained tasks and hairline-divided rows for scan-heavy lists.
- **Do** pair simple line icons with text for navigation and primary actions.
- **Do** preserve at least 48px standard touch targets, 16px primary text, visible focus, and keyboard access.
- **Do** adapt navigation and action placement deliberately at phone, tablet, and desktop sizes.

### Don't:

- **Don't** introduce decorative dashboards, metric mosaics, gradients, glass effects, or generic SaaS chrome.
- **Don't** add a second general-purpose accent colour; semantic colours are for status only.
- **Don't** use shadows when a hairline divider or tonal surface already explains the structure.
- **Don't** hide a primary action behind an unlabeled icon, hover state, or distant menu.
- **Don't** stretch mobile compositions across desktop widths; use the rail and task-oriented responsive rows.
- **Don't** replace plain home-business language with retail, warehouse, or accounting jargon.
