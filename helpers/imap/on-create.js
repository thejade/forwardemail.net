/*
 * Copyright (c) Forward Email LLC
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * This file incorporates work covered by the following copyright and
 * permission notice:
 *
 *   WildDuck Mail Agent is licensed under the European Union Public License 1.2 or later.
 *   https://github.com/nodemailer/wildduck
 */

const ms = require('ms');

const Aliases = require('#models/aliases');
const IMAPError = require('#helpers/imap-error');
const Mailboxes = require('#models/mailboxes');
const config = require('#config');
const i18n = require('#helpers/i18n');
const refineAndLogError = require('#helpers/refine-and-log-error');

async function onCreate(path, session, fn) {
  this.logger.debug('CREATE', { path, session });

  try {
    const { alias } = await this.refreshSession(session, 'CREATE');

    // check if over quota
    const { isOverQuota } = await Aliases.isOverQuota(alias);
    if (isOverQuota)
      throw new IMAPError(i18n.translate('IMAP_MAILBOX_OVER_QUOTA', 'en'), {
        imapResponse: 'OVERQUOTA'
      });

    //
    // limit the number of mailboxes a user can create
    // (Gmail defaults to 10,000 labels)
    // <https://github.com/nodemailer/wildduck/issues/512>
    //
    const count = await Mailboxes.countDocuments(this, session, {});

    if (count > config.maxMailboxes)
      throw new IMAPError(i18n.translate('IMAP_MAILBOX_MAX_EXCEEDED', 'en'), {
        imapResponse: 'OVERQUOTA'
      });

    let mailbox = await Mailboxes.findOne(this, session, {
      path
    });

    if (mailbox)
      throw new IMAPError(i18n.translate('IMAP_MAILBOX_ALREADY_EXISTS', 'en'), {
        imapResponse: 'ALREADYEXISTS'
      });

    mailbox = await Mailboxes.create({
      instance: this,
      session,
      path,
      retention: typeof alias.retention === 'number' ? alias.retention : 0
    });

    try {
      await this.server.notifier.addEntries(this, session, mailbox, {
        command: 'CREATE',
        mailbox: mailbox._id,
        path
      });
      this.server.notifier.fire(alias.id);
    } catch (err) {
      this.logger.fatal(err, { path, session });
    }

    // update storage
    try {
      await this.wsp.request({
        action: 'size',
        timeout: ms('5s'),
        alias_id: alias.id
      });
    } catch (err) {
      this.logger.fatal(err);
    }

    fn(null, true, mailbox._id);
  } catch (err) {
    if (err.code === 11000) err.imapResponse = 'ALREADYEXISTS';
    // NOTE: wildduck uses `imapResponse` so we are keeping it consistent
    if (err.imapResponse) {
      this.logger.error(err, { path, session });
      return fn(null, err.imapResponse);
    }

    fn(refineAndLogError(err, session, true));
  }
}

module.exports = onCreate;
