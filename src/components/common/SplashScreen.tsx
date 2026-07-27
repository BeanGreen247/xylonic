import React from 'react';
import './SplashScreen.css';

interface Props {
  visible: boolean;
}

const SplashScreen: React.FC<Props> = ({ visible }) => (
  <div className={`splash-screen ${visible ? 'splash-visible' : 'splash-hidden'}`} aria-hidden={!visible}>
    <div className="splash-content">
      <img src="/logo.svg" alt="" className="splash-logo" />
      <div className="splash-name">Xylonic</div>
    </div>
  </div>
);

export default SplashScreen;
