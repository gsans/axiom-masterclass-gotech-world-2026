import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideA2Ui, BasicCatalog } from '@a2ui/angular/v0_9';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { loggerFeature } from './logging/logger-reducer';
import { factoryFeature } from './store/factory.reducer';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideA2Ui(() => ({
      catalogs: [new BasicCatalog()],
    })),
    // NgRx Root Store + Redux DevTools (adapted from gsans/gemini-3-live-angular/src/app/app.config.ts)
    provideStore({
      logger: loggerFeature.reducer,
      factory: factoryFeature.reducer,
    }),
    provideStoreDevtools({
      maxAge: 50,
      logOnly: false,
      name: 'Axiom Mission Control (Gemini 3.8 Live)',
    }),
  ],
};
