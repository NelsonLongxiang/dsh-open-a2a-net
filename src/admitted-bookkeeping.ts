/** Observation of accepted input whose task birth did not commit; not a task status. */
import { safeObservationCode } from './nudge-observability.ts'
export const ADMITTED_BOOKKEEPING_NOTE='已送达、接收方记账失败，请对账，不要重派。Delivered, but receiver bookkeeping failed; reconcile the original task, do not redispatch.'
export class AdmittedBookkeepingError extends Error {
 readonly code:string
 constructor(error:unknown){super(ADMITTED_BOOKKEEPING_NOTE);this.code=safeObservationCode(error,'LEDGER_WRITE_FAILED')}
}
