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

const IMAPError = require('#helpers/imap-error');
const Mailboxes = require('#models/mailboxes');
const i18n = require('#helpers/i18n');
const refineAndLogError = require('#helpers/refine-and-log-error');

async function onUnsubscribe(path, session, fn) {
  this.logger.debug('UNSUBSCRIBE', { path, session });

  try {
    await this.refreshSession(session, 'UNSUBSCRIBE');

    const mailbox = await Mailboxes.findOneAndUpdate(
      this,
      session,
      {
        path
      },
      {
        $set: {
          subscribed: false
        }
      }
    );

    if (!mailbox)
      throw new IMAPError(
        i18n.translate('IMAP_MAILBOX_DOES_NOT_EXIST', session.user.locale),
        {
          imapResponse: 'NONEXISTENT'
        }
      );

    fn(null, true);
  } catch (err) {
    const error = refineAndLogError(err, session, true, this);
    if (error.imapResponse) return fn(null, error.imapResponse);
    fn(error);
  }
}

module.exports = onUnsubscribe;
