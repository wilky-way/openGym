import { beforeEach } from 'vitest'
import { configureTestClient } from './client-fixture'
import { configureProgrammeUi } from '../src/lib/programme-ui-services'
import { useStore } from '../src/store/useStore'
import * as sheets from '../src/sheets'
beforeEach(()=>{const platform=configureTestClient();useStore.setState({isGuest:()=>false});configureProgrammeUi({platform,startFlow:ids=>sheets.startFlow(ids),confirmSheet:opts=>sheets.confirmSheet(opts),workoutDetailSheet:w=>sheets.workoutDetailSheet(w),dayOverrideSheet:d=>sheets.dayOverrideSheet(d)})})
