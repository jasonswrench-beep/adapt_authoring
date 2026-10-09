import components from 'core/js/components';
import H5pPlayerView from './H5pPlayerView';
import H5pPlayerModel from './H5pPlayerModel';

export default components.register('h5pPlayer', {
  model: H5pPlayerModel,
  view: H5pPlayerView
});
