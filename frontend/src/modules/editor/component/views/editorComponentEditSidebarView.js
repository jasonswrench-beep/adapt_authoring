// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {
  var Backbone = require('backbone');
  var _ = require('underscore');
  var Origin = require('core/origin');
  var SidebarItemView = require('modules/sidebar/views/sidebarItemView');
  var SlidesImportReport = require('../../global/slidesImportReport');

  var EditorComponentEditSidebarView = SidebarItemView.extend({
    events: {
      'click .editor-component-edit-sidebar-save': 'saveEditing',
      'click .editor-component-edit-sidebar-cancel': 'cancelEditing',
      'click .editor-slides-import-button': 'chooseDeck',
      'change .editor-slides-import-file': 'importDeck'
    },

    // the PowerPoint import is only offered for Slides components
    postRender: function() {
      SidebarItemView.prototype.postRender.apply(this, arguments);
      if (this.model.get('_component') === 'slides') this.$('.editor-slides-import').removeClass('display-none');
    },

    chooseDeck: function(event) {
      event.preventDefault();
      this.$('.editor-slides-import-file').val('').trigger('click');
    },

    importDeck: function(event) {
      var file = event.currentTarget.files && event.currentTarget.files[0];
      if (!file) return;
      var t = function(key, options) { return Origin.l10n.t(key, options); };
      var $button = this.$('.editor-slides-import-button');
      var label = $button.find('span').text();
      var form = new FormData();
      form.append('file', file);
      $button.prop('disabled', true).find('span').text(t('app.importing'));
      $.ajax({
        url: 'api/content/component/' + this.model.get('_id') + '/pptx',
        type: 'POST',
        data: form,
        processData: false,
        contentType: false
      }).done(function(data) {
        Origin.Notify.alert({
          type: 'success',
          title: t('app.importpptxtitle'),
          text: SlidesImportReport.buildHtml(data.payload, t, _.escape),
          // reload so the form shows the imported slides (any unsaved edits on this screen are replaced)
          callback: function() { window.location.reload(); }
        });
      }).fail(function(jqXHR) {
        var message = (jqXHR.responseJSON && jqXHR.responseJSON.message) || t('app.errorgeneric');
        Origin.Notify.alert({ type: 'error', title: t('app.importpptxfailed'), text: _.escape(message) });
        $button.prop('disabled', false).find('span').text(label);
      });
    },

    saveEditing: function(event) {
      event.preventDefault();
      this.updateButton('.editor-component-edit-sidebar-save', Origin.l10n.t('app.saving'));
      Origin.trigger('editorComponentEditSidebar:views:save');
    },

    cancelEditing: function(event) {
      event.preventDefault();
      // FIXME got to be a better way to do this
      this.model.fetchParent(function(parentBlock) {
        parentBlock.fetchParent(function(parentArticle) {
          parentArticle.fetchParent(function(parentPage) {
            Origin.router.navigateTo('editor/' + Origin.editor.data.course.get('_id') + '/page/' + parentPage.get('_id'));
          });
        });
      });
    }
  }, {
    template: 'editorComponentEditSidebar'
  });

  return EditorComponentEditSidebarView;
});
