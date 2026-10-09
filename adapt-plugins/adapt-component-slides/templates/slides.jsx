import React from 'react';
import a11y from 'core/js/a11y';
import { templates, compile, classes } from 'core/js/reactHelpers';

export default function Slides(props) {
  const { _id, _items, title, _nextText, _backText, _progressText } = props;
  const count = _items.length;

  return (
    <div className="component__inner slides__inner">
      <templates.header {...props} />
      <div className="component__widget slides__widget">
        <div
          className="slides__region js-slides-region"
          role="group"
          aria-roledescription="carousel"
          aria-label={title || 'Slides'}
        >
          <div className="slides__stage js-slides-stage">
            {_items.map(({ _index, title: slideTitle, body, _graphic, _imagePosition }) =>
              <div
                className={classes([
                  'slides__slide js-slides-slide',
                  _graphic && _graphic.src && `has-image is-image-${_imagePosition || 'top'}`
                ])}
                role="group"
                aria-roledescription="slide"
                aria-label={`${_index + 1} of ${count}`}
                data-index={_index}
                tabIndex={-1}
                hidden={_index !== 0}
                key={_index}
              >
                {_graphic && _graphic.src &&
                  <div className="slides__image">
                    <templates.image {..._graphic}
                      classNamePrefixes={['slides__image-item']}
                      attributionClassNamePrefixes={['component', 'slides']}
                      draggable="false"
                    />
                  </div>
                }
                <div className="slides__content">
                  {slideTitle &&
                    <div
                      className="slides__slide-title"
                      role="heading"
                      aria-level={a11y.ariaLevel({ id: _id, level: 'componentItem' })}
                      dangerouslySetInnerHTML={{ __html: compile(slideTitle, props) }}
                    />
                  }
                  {body &&
                    <div className="slides__slide-body" dangerouslySetInnerHTML={{ __html: compile(body, props) }} />
                  }
                </div>
              </div>
            )}
          </div>

          <div className="slides__controls">
            <button type="button" className="btn-text slides__button slides__back js-slides-back">
              {_backText || 'Back'}
            </button>
            <div className="slides__status">
              {props._showProgress !== false &&
                <span className="slides__progress js-slides-progress" aria-live="polite">
                  {(_progressText || 'Slide {{current}} of {{total}}').replace('{{current}}', 1).replace('{{total}}', count)}
                </span>
              }
              <div className="slides__dots">
                {_items.map(({ _index, title: slideTitle }) =>
                  <button
                    type="button"
                    className="slides__dot js-slides-dot"
                    data-index={_index}
                    aria-label={`Go to slide ${_index + 1} of ${count}`}
                    key={_index}
                  >
                    <span className="slides__dot-mark" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <button type="button" className="btn-text slides__button slides__next js-slides-next">
              {_nextText || 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
