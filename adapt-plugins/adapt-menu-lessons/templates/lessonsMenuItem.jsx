import React from 'react';
import Adapt from 'core/js/adapt';
import { classes, compile, templates } from 'core/js/reactHelpers';

export default function LessonsMenuItem (props) {

  const {
    displayTitle,
    _graphic,
    body,
    duration,
    linkText,
    _linkIconClass,
    _linkIconPosition,
    _isVisited,
    _isLocked,
    _isComplete,
    title,
    _isOptional,
    _priorityClass,
    _priorityIconClass,
    priorityLabel,
    _nthChild,
    _totalChild
  } = props;

  const _globals = Adapt.course.get('_globals');
  const labels = _globals?._menu?._lessonsMenu || {};

  // Learner progress drives the visible status text (not colour alone) and the button label
  const progress = _isComplete ? 'complete' : (_isVisited ? 'inprogress' : 'notstarted');
  const statusText = {
    complete: labels.completedLabel || 'Completed',
    inprogress: labels.inProgressLabel || 'In progress',
    notstarted: labels.notStartedLabel || 'Not started'
  }[progress];
  const buttonText = {
    complete: labels.reviewText || 'Review',
    inprogress: labels.continueText || 'Continue',
    notstarted: labels.startText || 'Start'
  }[progress];

  const durationLabel = duration
    ? [_globals?._menu?._lessonsMenu?.durationLabel.trim(), duration].filter(Boolean).join(' ')
    : '';

  const visited = _isVisited ? _globals?._accessibility?._ariaLabels?.visited : '';
  const complete = _isComplete ? _globals?._accessibility?._ariaLabels?.complete : '';
  const completion = complete || visited;
  const locked = _isLocked ? _globals?._accessibility?._ariaLabels?.locked : buttonText;
  const optional = _isOptional ? _globals?._accessibility?._ariaLabels?.optional : '';
  const itemCount = compile(_globals?._menu?._lessonsMenu?.itemCount || '', { _nthChild, _totalChild });
  const ariaLabel = [
    `${statusText}.`, locked, `${title}.`, `${itemCount}.`, `${optional}`
  ].filter(Boolean).join(' ');

  return (
    <div className="menu-item__inner lessons-item__inner">

      <templates.image {..._graphic}
        classNamePrefixes={['menu-item', 'lessons-item']}
        alt={null}
        attribution={null}
      />

      <div className="menu-item__details lessons-item__details">
        <div className="menu-item__details-inner lessons-item__details-inner">

          {priorityLabel &&
          <div className={classes([
            'menu-item__priority lessons-item__priority',
            _priorityClass
          ])}>
            {_priorityIconClass &&
              <span className={classes(['icon', _priorityIconClass])} aria-hidden="true" />
            }
            <div
              className="menu-item__priority-label lessons-item__priority-label"
              dangerouslySetInnerHTML={{ __html: compile(priorityLabel, props) }}
            />
          </div>
          }

          <div className="menu-item__meta lessons-item__meta">
            <span className="menu-item__number lessons-item__number" aria-hidden="true">{_nthChild}</span>
            <span className={classes([
              'menu-item__status-text',
              'lessons-item__status-text',
              `is-${progress}`
            ])}>
              {statusText}
            </span>
          </div>

          {displayTitle &&
          <div className="menu-item__title lessons-item__title">
            <div
              className={classes([
                'menu-item__title-inner',
                'lessons-item__title-inner',
                'js-heading'
              ])}
              data-a11y-heading-type="menuItem">
            </div>
          </div>
          }

          {_graphic?.alt &&
          <span
            className="aria-label"
            dangerouslySetInnerHTML={{ __html: compile(_graphic.alt) }}
          />
          }

          {body &&
          <div className="menu-item__body lessons-item__body">
            <div
              className="menu-item__body-inner lessons-item__body-inner"
              dangerouslySetInnerHTML={{ __html: compile(body) }}
            />
          </div>
          }

          {duration &&
          <div className="menu-item__duration lessons-item__duration">
            <div
              className="menu-item__duration-inner lessons-item__duration-inner"
              dangerouslySetInnerHTML={{ __html: compile(durationLabel, props) }}
            />
          </div>
          }

          <div className={classes([
            'menu-item__progress',
            'lessons-item__progress',
            'js-menu-item-progress'
          ])}>
            {/* Menu item progress bar will render here */}
          </div>

          <div className="menu-item__button-container lessons-item__button-container">
            <button
              className={classes([
                'btn-text',
                'menu-item__button',
                'lessons-item__button',
                'js-btn-click',
                _linkIconClass && 'has-icon',
                (_linkIconClass && _linkIconPosition) && `has-icon-${_linkIconPosition}`,
                _isVisited && 'is-visited',
                _isLocked && 'is-locked'
              ])}
              aria-label={ariaLabel}
              aria-disabled={_isLocked ? true : null}
              role="link"
            >
              {_linkIconClass &&
                <span className="menu-item__button-icon lessons-item__button-icon" aria-hidden="true">
                  <span className={classes([
                    'icon',
                    _linkIconClass
                  ])} />
                </span>
              }
              <span className="menu-item__button-text lessons-item__button-text">
                {buttonText}
              </span>
            </button>

            <span className='menu-item__status lessons-item__status'>
              <span className='icon' aria-hidden="true" />
            </span>
          </div>

        </div>
      </div>

    </div>
  );
}
