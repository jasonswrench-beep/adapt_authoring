import React from 'react';
import { compile, classes } from 'core/js/reactHelpers';

export default function LessonsMenuGroup (props) {

  const {
    displayTitle,
    body,
    instruction
  } = props;

  return (
    <div className="menu-group__inner lessons-group__inner">

      <div className="menu-group__header lessons-group__header">
        <div className="menu-group__header-inner lessons-group__header-inner">

          {displayTitle &&
          <div className="menu-group__title lessons-group__title">
            <div
              className={classes([
                'menu-group__title-inner',
                'lessons-group__title-inner',
                'js-heading'
              ])}
              data-a11y-heading-type="menuGroup"
            />
          </div>
          }

          {body &&
          <div className="menu-group__body lessons-group__body">
            <div
              className="menu-group__body-inner lessons-group__body-inner"
              dangerouslySetInnerHTML={{ __html: compile(body) }}
            />
          </div>
          }

          {instruction &&
          <div className="menu-group__instruction lessons-group__instruction">
            <div
              className="menu-group__instruction-inner lessons-group__instruction-inner"
              dangerouslySetInnerHTML={{ __html: compile(instruction) }}
            />
          </div>
          }

          <div className={classes([
            'menu-group__progress',
            'lessons-group__progress',
            'js-menu-item-progress'
          ])}>
            {/* Menu item progress bar will render here */}
          </div>

        </div>
      </div>

      <div className="menu-group__container lessons-group__container">
        <div
          className={classes([
            'menu-group__item-container-inner',
            'lessons-group__item-container-inner',
            'js-group-children'
          ])}
          role="list"
        >
          {/* Grouped menu items render here */}
        </div>
      </div>

    </div>
  );
}
