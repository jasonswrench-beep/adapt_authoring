import React from 'react';
import Adapt from 'core/js/adapt';
import { templates } from 'core/js/reactHelpers';

export default function h5pPlayer(props) {
  const _globals = Adapt.course.get('_globals');
  const labels = _globals?._components?._h5pPlayer || {};
  const errorText = labels.loadError || 'This activity could not be loaded.';
  const pendingText = labels.pendingMessage || 'This activity is waiting for an instructor to approve it.';
  const rejectedText = labels.rejectedMessage || 'This activity has not been approved for use.';

  return (
    <div className="component__inner h5pplayer__inner">
      <templates.header {...props} />
      <div className="component__widget h5pplayer__widget">
        <div className="h5pplayer__container js-h5p-container" />
        <p className="h5pplayer__error js-h5p-error" role="alert" hidden>
          {errorText}
        </p>
        <p className="h5pplayer__notice js-h5p-pending" role="status" hidden>
          {pendingText}
        </p>
        <p className="h5pplayer__notice js-h5p-rejected" role="status" hidden>
          {rejectedText}
        </p>
      </div>
    </div>
  );
}
