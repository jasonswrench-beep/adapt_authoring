// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * The H5P activity gallery: a dialog in which an author browses ready-made H5P activities, reads what each is best
 * for, and picks one for the H5P Player component being edited. The server does the work (see h5pLibrary.js).
 * Everything that comes from the catalogue is escaped before it is put on the page.
 */
define(function(require) {
  var $ = require('jquery');
  var _ = require('underscore');
  var Origin = require('core/origin');
  var Filter = require('./h5pLibraryFilter');

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function t(key, options) { return Origin.l10n.t(key, options); }

  function open(model, trigger) {
    var componentId = model.get('_id');
    var base = 'api/content/component/' + componentId + '/h5plibrary';
    var state = { category: '', query: '', activities: [] };
    var busy = false;

    var $overlay = $('<div class="h5p-gallery-overlay"></div>');
    var $dialog = $(
      '<div class="h5p-gallery" role="dialog" aria-modal="true" aria-labelledby="h5p-gallery-title">' +
        '<div class="h5p-gallery-header">' +
          '<h2 id="h5p-gallery-title">' + _.escape(t('app.h5plibrarytitle')) + '</h2>' +
          '<button type="button" class="h5p-gallery-close" aria-label="' + _.escape(t('app.h5plibraryclose')) + '">&times;</button>' +
        '</div>' +
        '<p class="h5p-gallery-intro">' + _.escape(t('app.h5plibraryintro')) + '</p>' +
        '<div class="h5p-gallery-tools">' +
          '<label for="h5p-gallery-search">' + _.escape(t('app.h5plibrarysearch')) + '</label>' +
          '<input type="search" id="h5p-gallery-search" autocomplete="off">' +
          '<div class="h5p-gallery-categories" role="group" aria-label="' + _.escape(t('app.h5plibrarycategories')) + '"></div>' +
        '</div>' +
        '<p class="h5p-gallery-status" role="status" aria-live="polite"></p>' +
        '<ul class="h5p-gallery-list"></ul>' +
      '</div>'
    );
    $overlay.append($dialog);
    $('body').append($overlay);

    function close() {
      $(document).off('keydown.h5pgallery');
      $overlay.remove();
      if (trigger) $(trigger).trigger('focus');
    }

    function renderCategories() {
      var $bar = $dialog.find('.h5p-gallery-categories').empty();
      [''].concat(Filter.categories(state.activities)).forEach(function(category) {
        var label = category || t('app.h5plibraryall');
        $('<button type="button" class="h5p-gallery-category"></button>')
          .text(label)
          .attr('aria-pressed', String(state.category === category))
          .toggleClass('is-active', state.category === category)
          .data('category', category)
          .appendTo($bar);
      });
    }

    function renderList() {
      var shown = Filter.filter(state.activities, state.category, state.query);
      var $list = $dialog.find('.h5p-gallery-list').empty();
      shown.forEach(function(a) {
        var scoring = a.completion === 'activity' ? t('app.h5plibraryscored') : t('app.h5plibraryviewed');
        var thumb = a.thumbnail ? '<img class="h5p-gallery-thumb" loading="lazy" alt="" src="' + base + '/thumb/' + encodeURIComponent(a.id) + '">' : '<div class="h5p-gallery-thumb h5p-gallery-thumb-none"></div>';
        var $card = $(
          '<li class="h5p-gallery-card">' + thumb +
            '<div class="h5p-gallery-card-body">' +
              '<h3>' + _.escape(a.title) + '</h3>' +
              '<p class="h5p-gallery-summary">' + _.escape(a.summary) + '</p>' +
              '<p class="h5p-gallery-best"><strong>' + _.escape(t('app.h5plibrarybestfor')) + '</strong> ' + _.escape(a.bestFor) + '</p>' +
              (a.notes ? '<p class="h5p-gallery-note">' + _.escape(a.notes) + '</p>' : '') +
              '<p class="h5p-gallery-tags"><span>' + _.escape(a.category) + '</span> <span>' + _.escape(scoring) + '</span></p>' +
              '<button type="button" class="action-primary h5p-gallery-use"></button>' +
            '</div>' +
          '</li>'
        );
        $card.find('.h5p-gallery-use').text(t('app.h5plibraryuse')).attr('aria-label', t('app.h5plibraryuseaa', { title: a.title })).data('activity', a).prop('disabled', !a.available);
        $list.append($card);
      });
      var message = shown.length ? t('app.h5plibrarycount', { count: shown.length }) : t('app.h5plibrarynone');
      if (state.activities.length && !state.activities[0].available) message = t('app.h5plibrarynotinstalled');
      $dialog.find('.h5p-gallery-status').text(message);
    }

    function choose(activity) {
      if (busy) return;
      var hasActivity = model.get('properties') && model.get('properties')._h5p && model.get('properties')._h5p._src;
      var proceed = function() {
        busy = true;
        $dialog.find('.h5p-gallery-use').prop('disabled', true);
        $dialog.find('.h5p-gallery-status').text(t('app.h5plibraryadding', { title: activity.title }));
        $.ajax({ url: base, type: 'POST', contentType: 'application/json', data: JSON.stringify({ activity: activity.id }) })
          .done(function(data) {
            close();
            var summary = data.payload || {};
            var text = '<p>' + _.escape(t('app.h5plibraryadded', { title: summary.title || activity.title })) + '</p>' +
              '<p>' + _.escape(summary.completion === 'activity' ? t('app.h5plibraryscoredhelp') : t('app.h5plibraryviewedhelp')) + '</p>' +
              (summary.notes ? '<p>' + _.escape(summary.notes) + '</p>' : '');
            Origin.Notify.alert({ type: 'success', title: t('app.h5plibrarytitle'), text: text, callback: function() { window.location.reload(); } });
          })
          .fail(function(jqXHR) {
            busy = false;
            $dialog.find('.h5p-gallery-use').prop('disabled', false);
            var message = (jqXHR.responseJSON && jqXHR.responseJSON.message) || t('app.errorgeneric');
            $dialog.find('.h5p-gallery-status').text('');
            Origin.Notify.alert({ type: 'error', title: t('app.h5plibraryfailed'), text: _.escape(message) });
          });
      };
      if (!hasActivity) return proceed();
      Origin.Notify.confirm({
        type: 'warning',
        title: t('app.h5plibraryreplacetitle'),
        text: t('app.h5plibraryreplace'),
        destructive: false,
        callback: function(confirmed) { if (confirmed) proceed(); }
      });
    }

    $dialog.on('click', '.h5p-gallery-close', close);
    $overlay.on('mousedown', function(event) { if (event.target === $overlay[0]) close(); });
    $dialog.on('input', '#h5p-gallery-search', function() { state.query = this.value; renderList(); });
    $dialog.on('click', '.h5p-gallery-category', function() {
      state.category = $(this).data('category');
      renderCategories();
      renderList();
    });
    $dialog.on('click', '.h5p-gallery-use', function() { choose($(this).data('activity')); });
    $(document).on('keydown.h5pgallery', function(event) {
      if (event.key === 'Escape') { event.preventDefault(); return close(); }
      if (event.key !== 'Tab') return;
      var $items = $dialog.find(FOCUSABLE).filter(':visible');
      if (!$items.length) return;
      var first = $items[0];
      var last = $items[$items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !$dialog[0].contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    $dialog.find('.h5p-gallery-status').text(t('app.h5plibraryloading'));
    $dialog.find('#h5p-gallery-search').trigger('focus');
    $.getJSON(base).done(function(data) {
      state.activities = data.payload || [];
      renderCategories();
      renderList();
    }).fail(function(jqXHR) {
      var message = (jqXHR.responseJSON && jqXHR.responseJSON.message) || t('app.errorgeneric');
      $dialog.find('.h5p-gallery-status').text(message);
    });
  }

  return { open: open };
});
