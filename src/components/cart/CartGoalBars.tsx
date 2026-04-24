/**
 * @deprecated WEC-165 — this file has been replaced by the shared component at
 * `src/components/shared/DayMacrosBlock.tsx`, which is used by both the cart
 * sidebar and the checkout order summary. Imports through this shim continue
 * to work; new code should import `DayMacrosBlock` directly.
 *
 * TODO: delete this file once no imports reference the old name.
 */
export { DayMacrosBlock as CartGoalBars } from '../shared/DayMacrosBlock'
