import React from 'react';
import Adapt from 'core/js/adapt';
import { templates } from 'core/js/reactHelpers';

export default function h5pPlayer(props) {
  const _globals = Adapt.course.get('_globals');
  const errorText = _globals?._components?._h5pPlayer?.loadError || 'This activity could not be loaded.';

  return (
    <div className="component__inner h5pplayer__inner">
      <templates.header {...props} />
      <div className="component__widget h5pplayer__widget">
        <div className="h5pplayer__container js-h5p-container" />
        <p className="h5pplayer__error js-h5p-error" role="alert" hidden>
          {errorText}
        </p>
      </div>
    </div>
  );
}
