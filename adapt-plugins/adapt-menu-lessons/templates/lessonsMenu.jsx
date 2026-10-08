import React from 'react';
import Adapt from 'core/js/adapt';
import device from 'core/js/device';
import { classes, compile } from 'core/js/reactHelpers';

export default function LessonsMenu (props) {
  const {
    displayTitle,
    subtitle,
    body,
    pageBody,
    instruction,
    _priorityClass,
    _priorityIconClass,
    priorityLabel
  } = props;

  const _lessonsMenu = Adapt.course.get('_lessonsMenu');

  // set menu logo image
  const _graphic = _lessonsMenu?._graphic;

  // set menu background image
  const backgroundImages = _lessonsMenu?._backgroundImage;
  const backgroundImage = backgroundImages?.[`_${device.screenSize}`] ?? backgroundImages?._small;
  // set menu background styles
  const styles = _lessonsMenu?._backgroundStyles || {};

  // set header background image
  const header = _lessonsMenu?._menuHeader;
  const headerBackgroundImages = header?._backgroundImage;
  const headerBackgroundImage = headerBackgroundImages?.[`_${device.screenSize}`] ?? headerBackgroundImages?._small;
  // set header background styles
  const headerBackgroundStyles = header?._backgroundStyles || {};
  // set header minimum height
  const headerMinimumHeights = header?._minimumHeights;
  const headerMinimumHeight = headerMinimumHeights?.[`_${device.screenSize}`] ?? headerMinimumHeights?._small;

  return (
    <>
      {backgroundImages &&
      <div
        className="background"
        aria-hidden="true"
        style={{
          backgroundImage: backgroundImage && 'url(' + backgroundImage + ')',
          backgroundRepeat: styles._backgroundRepeat,
          backgroundSize: styles._backgroundSize,
          backgroundPosition: styles._backgroundPosition
        }}
      />
      }

      <div className="menu__inner lessons__inner">
        {(displayTitle || subtitle || body || instruction) &&
        <div
          className={classes([
            'menu__header',
            'lessons__header',
            headerBackgroundImage && 'has-bg-image',
            headerMinimumHeight && 'has-min-height'
          ])}
          style={ headerMinimumHeight ? { minHeight: headerMinimumHeight + 'px' } : null }
        >

          {headerBackgroundImages &&
          <div
            className="background"
            aria-hidden="true"
            style={{
              backgroundImage: headerBackgroundImage && 'url(' + headerBackgroundImage + ')',
              backgroundRepeat: headerBackgroundStyles._backgroundRepeat,
              backgroundSize: headerBackgroundStyles._backgroundSize,
              backgroundPosition: headerBackgroundStyles._backgroundPosition
            }}
          />
          }

          <div className="menu__header-inner lessons__header-inner">

            {_graphic?._src &&
            <div className="menu__image-container lessons__image-container">
              <img
                className="menu__image lessons__image"
                src={_graphic?._src}
                alt={_graphic?.alt}
              />
            </div>
            }

            <div className="menu__header-content lessons__header-content">
              {priorityLabel &&
                <div className={classes([
                  'menu__priority lessons__priority',
                  _priorityClass
                ])}>
                  {_priorityIconClass &&
                    <span className={classes(['icon', _priorityIconClass])} aria-hidden="true" />
                  }
                  <div
                    className="menu__priority-label lessons__priority-label"
                    dangerouslySetInnerHTML={{ __html: compile(priorityLabel, props) }}
                  />
                </div>
              }

              {displayTitle &&
              <div className="menu__title lessons__title">
                <div className={classes([
                  'menu__title-inner',
                  'lessons__title-inner',
                  'js-heading'
                ])} />
              </div>
              }

              {subtitle &&
              <div className="menu__subtitle lessons__subtitle">
                <div
                  className="menu__subtitle-inner lessons__subtitle-inner"
                  dangerouslySetInnerHTML={{ __html: compile(subtitle) }}
                />
              </div>
              }

              {(body || pageBody) &&
              <div className="menu__body lessons__body">
                <div
                  className="menu__body-inner lessons__body-inner"
                  dangerouslySetInnerHTML={{ __html: compile(pageBody || body) }}
                />
              </div>
              }

              {instruction &&
              <div className="menu__instruction lessons__instruction">
                <div
                  className="menu__instruction-inner lessons__instruction-inner"
                  dangerouslySetInnerHTML={{ __html: compile(instruction) }}
                />
              </div>
              }

            </div>

          </div>
        </div>
        }

        <div className="menu__item-container lessons__item-container">
          <div
            className={classes([
              'menu__item-container-inner',
              'lessons__item-container-inner',
              'js-children'
            ])}
            role="list"
          >
            {/* Menu items render here */}
          </div>
        </div>

      </div>
    </>
  );
}
