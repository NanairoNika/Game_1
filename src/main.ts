import Phaser from 'phaser';
import { GameScene } from './GameScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 720,
  height: 1280,
  backgroundColor: '#141a14',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [GameScene],
});
