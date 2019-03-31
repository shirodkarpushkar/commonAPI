const con = require("../database/mysql");
const functions = require("../common/functions");
const config = require("../../config");
const validator = require("validator");
const code = require("../common/code");
const message = require("../common/message");
const fs = require("fs");
const util = require("util");
const query = util.promisify(con.query).bind(con);

class UserService {
  /**
   * API for user registration
   * @param {*} req (user detials)
   * @param {*} res (json with success/failure)
   */
  async registration(info) {
    try {
      if (validator.isEmail(info.data.emailAddress)) {
        const userPassword = functions.encryptPassword(info.data.userPassword);
        const sqlQuery = "INSERT INTO user(firstName, middleName, lastName, emailAddress, userPassword, address, mobileNumber) VALUES (?, ?, ?, ?, ?, ?, ?)";
        const registrationDetails = await query(sqlQuery, [info.data.firstName, info.data.middleName, info.data.lastName, info.data.emailAddress, userPassword, info.data.address, info.data.mobileNumber]);
        try {
          let token = await functions.tokenEncrypt(info.data.emailAddress);
          token = Buffer.from(token, "ascii").toString("hex");
          let emailMessage = fs.readFileSync("./modules/emailtemplate/welcome.html", "utf8").toString();
          emailMessage = emailMessage.replace("$fullname", info.data.firstName).replace("$link", config.emailVerifiedLink + token);
          try {
            const emailDetails = await functions.sendEmail(info.data.emailAddress, message.registrationEmailSubject, emailMessage);
            return { code: code.success, message: message.registration, data: registrationDetails };
          } catch (error) {
            return { code: code.invalidDetails, message: message.invalidDetails, data: error };
          }
        } catch (error) {
          return { code: code.invalidDetails, message: message.invalidDetails, data: error };
        }
      } else {
        return { code: code.invalidDetails, message: message.invalidDetails };
      }
    } catch (e) {
      return { code: code.invalidDetails, message: message.tryCatch, data: e };
    }
  }

  /**
   * API for email verification
   * @param {*} req (email)
   * @param {*} res (json with success/failure)
   */
  async verifyEmail(info) {
    if (info.data.emailAddress) {
      const token = Buffer.from(info.data.emailAddress, "hex").toString("ascii");
      try {
        const tokenDecrypt = await functions.tokenDecrypt(token);
        console.log("TCL: UserService -> verifyEmail -> tokenDecrypt", tokenDecrypt);
        if (tokenDecrypt.message === "jwt expired") {
          return { code: code.sessionExpire, message: message.emailLinkExpired };
        } else {
          try {
            const verifyEmailDetails = await query("UPDATE user SET isEmailVerified = 1 WHERE emailAddress = ?", [tokenDecrypt.data]);
            return { code: code.success, message: message.emailVerificationSuccess, data: verifyEmailDetails };
          } catch (error) {
            return { code: code.dbCode, message: message.dbError, data: error };
          }
        }
      } catch (e) {
        return { code: code.invalidDetails, message: message.tryCatch, data: e };
      }
    } else {
      return { code: code.invalidDetails, message: message.invalidDetails };
    }
  }

  /**
   * API for user login
   * @param {*} req (email address & password)
   * @param {*} res (json with success/failure)
   */
  async login(info) {
    try {
      if (validator.isEmail(info.data.emailAddress)) {
        const sqlQuery = "SELECT id, firstName, middleName, lastName, address, emailAddress, userPassword, mobileNumber, isEmailVerified, isActive FROM user WHERE emailAddress = ?";
        const loginDetails = await query(sqlQuery, [info.data.emailAddress]);
        try {
          if (loginDetails.length > 0) {
            const password = functions.decryptPassword(loginDetails[0].userPassword);
            if (password === info.data.userPassword) {
              if (loginDetails[0].isActive === 1) {
                if (loginDetails[0].isEmailVerified === 1) {
                  delete loginDetails[0].userPassword;
                  delete loginDetails[0].isEmailVerified;
                  delete loginDetails[0].isActive;
                  const token = await functions.tokenEncrypt(loginDetails[0]);
                  return { code: code.success, message: message.success, data: loginDetails, token: token };
                } else {
                  return { code: code.invalidDetails, message: message.emailVerify, data: [] };
                }
              } else {
                return { code: code.invalidDetails, message: message.accountDisable, data: [] };
              }
            } else {
              return { code: code.invalidDetails, message: message.invalidLoginDetails, data: [] };
            }
          } else {
            return { code: code.invalidDetails, message: message.invalidLoginDetails, data: [] };
          }
        } catch (error) {
          return { code: code.dbCode, message: message.dbError, data: error };
        }
      } else {
        return { code: code.invalidDetails, message: message.invalidLoginDetails, data: [] };
      }
    } catch (e) {
      return { code: code.invalidDetails, message: message.tryCatch, data: e };
    }
  }

  /**
   * API to Change password
   * @param {*} req (old password, token, new password )
   * @param {*} res (json with success/failure)
   */
  async changePassword(id, info) {
    try {
      const userDetails = await query("SELECT userPassword FROM user WHERE id = ?", [id]);
      if (userDetails.length > 0) {
        let password = functions.decryptPassword(userDetails[0].userPassword);
        if (password === info.data.oldPassword) {
          // Encrypt password for the user
          password = functions.encryptPassword(info.data.newPassword);
          const updatePasswordDetails = await query("UPDATE user SET userPassword = ? WHERE id = ?", [password, id]);
          return { code: code.success, message: message.passwordChanged, data: updatePasswordDetails };
        } else {
          return { code: code.invalidDetails, message: message.invalidDetails, data: [] };
        }
      } else {
        return { code: code.invalidDetails, message: message.invalidDetails, data: [] };
      }
    } catch (e) {
      return { code: code.dbCode, message: message.dbError, data: e };
    }
  }

  /**
   * API for Forgot Password
   * @param {*} req (email address )
   * @param {*} res (json with success/failure)
   */
  async forgotPassword(info) {
    try {
      if (validator.isEmail(info.data.emailAddress)) {
        const userDetail = await query("SELECT emailAddress, firstName FROM user WHERE emailAddress = ?", [info.data.emailAddress]);
        if (userDetail.length > 0) {
          const to = userDetail[0].emailAddress;
          let token = await functions.tokenEncrypt(to);
          token = Buffer.from(token, "ascii").toString("hex");
          const subject = message.forgotPasswordSubject;
          const link = config.resetPasswordLink + token;
          let emailMessage = fs.readFileSync("./modules/emailtemplate/reset.html", "utf8").toString();
          emailMessage = emailMessage
            .replace("$fullname", userDetail[0].firstName)
            .replace("$link", link)
            .replace("$emailId", config.supportEmail);
          try {
            const emailDetails = await functions.sendEmail(to, subject, emailMessage);
            return { code: code.success, message: message.resetLink, data: emailDetails };
          } catch (error) {
            return { code: code.invalidDetails, message: message.dbError, data: error };
          }
        } else {
          return { code: code.invalidDetails, message: message.invalidEmail, data: [] };
        }
      } else {
        return { code: code.invalidDetails, message: message.invalidEmail, data: [] };
      }
    } catch (error) {
      return { code: code.dbCode, message: message.dbError, data: error };
    }
  }

  /**
   * API for Reset Password
   * @param {*} req (emailAddress )
   * @param {*} res (json with success/failure)
   */
  async resetPassword(info) {
    try {
      if (info.data.emailAddress) {
        const emailAddress = Buffer.from(info.data.emailAddress, "hex").toString("ascii");
        const emailAddressDetails = await functions.tokenDecrypt(emailAddress);
        if (emailAddressDetails.data) {
          //Encrypt password for the user
          const password = functions.encryptPassword(info.data.newPassword);
          const passwordDetails = await query("UPDATE user SET userPassword = ? WHERE emailAddress = ?", [password, emailAddressDetails.data]);
          return { code: code.success, message: message.passwordReset, data: passwordDetails };
        } else {
          return { code: code.invalidDetails, message: message.emailLinkExpired, data: null };
        }
      } else {
        return { code: code.invalidDetails, message: message.invalidEmail };
      }
    } catch (e) {
      return { code: code.invalidDetails, message: message.tryCatch, data: e };
    }
  }
}

module.exports = {
  userService: function() {
    return new UserService();
  }
};

// /**
//  * API to update profile
//  * @param {*} req (token, user information )
//  * @param {*} res (json with success/failure)
//  */
// function updateProfile(info, id) {
//   return new Promise((resolve, reject) => {
//     try {
//       if (!validator.isEmpty(info.data.firstName) && !validator.isEmpty(info.data.middleName) && !validator.isEmpty(info.data.lastName) && !validator.isEmpty(info.data.address)) {
//         con.query("UPDATE user SET firstName = ?, middleName = ?, lastName = ?, address = ? WHERE id= ?", [info.data.firstName, info.data.middleName, info.data.lastName, info.data.address, id], (err, updateDetails) => {
//           if (err) {
//             reject({ code: code.dbCode, message: message.dbError, data: err });
//           } else {
//             resolve({ code: "00", message: message.profileUpdate });
//           }
//         });
//       } else {
//         reject({ code: code.invalidDetails, message: message.allFieldReq });
//       }
//     } catch (e) {
//       reject({ code: code.invalidDetails, message: message.tryCatch, data: e });
//     }
//   });
// }

// /**
//  * API for user history
//  * @param {*} req (userId)
//  * @param {*} res (json with success/failure)
//  */
// function userInformation(id) {
//   return new Promise((resolve, reject) => {
//     try {
//       con.query("SELECT firstName, middleName, lastName, address, mobileNumber FROM user u WHERE id = ?", [id], (err, userDetail) => {
//         if (err) {
//           reject({ code: code.dbCode, message: message.dbError, data: err });
//         } else if (userDetail.length > 0) {
//           resolve({ code: code.success, message: message.success, data: userDetail });
//         } else {
//           reject({ code: code.invalidDetails, message: message.noData });
//         }
//       });
//     } catch (e) {
//       reject({ code: code.invalidDetails, message: message.tryCatch, data: e });
//     }
//   });
// }

// module.exports = {
//   registration,
//   login,
//   verifyEmail,
//   changePassword,
//   forgetPassword,
//   resetPassword,
//   updateProfile,
//   userInformation
// };