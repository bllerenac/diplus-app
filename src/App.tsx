import { Redirect, Route } from 'react-router-dom';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';

import Navegacion from './paginas/Navegacion';
import Ajustes from './paginas/Ajustes';
import Monitor from './paginas/Monitor';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* Sin tema claro: esto se mira en una cabina. */
import '@ionic/react/css/palettes/dark.always.css';
import './theme/variables.css';

setupIonicReact({ mode: 'md' });

/**
 * Sin barra de pestañas: la pantalla principal es el mapa a pantalla completa,
 * y a lo demas se llega desde su barra superior. Una fila de pestañas quitaria
 * altura de mapa todo el rato para dos sitios a los que se entra de vez en
 * cuando.
 */
export default function App() {
  return (
    <IonApp>
      <IonReactRouter>
        <IonRouterOutlet>
          <Route exact path="/navegacion" component={Navegacion} />
          <Route exact path="/monitor" component={Monitor} />
          <Route exact path="/ajustes" component={Ajustes} />
          <Route exact path="/">
            <Redirect to="/navegacion" />
          </Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </IonApp>
  );
}
