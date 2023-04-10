import { createTheme } from '@mui/material/styles';

export default createTheme({
    components: {
      MuiButton: {
        styleOverrides: {
          contained: {
            borderRadius: 100,
            padding: "6px 28px",
            backgroundColor: "rgba(228, 0, 70, 1)",
            fontSize: "12px",
            lineHeight: "22px",
            textTransform: "unset",
            fontWeight: 400,
            "&:hover": {
              backgroundColor: "rgba(228, 0, 70, .8)",
              boxShadow: "unset"
            },
            boxShadow: "unset"
          },
          outlined: {
            borderRadius: 100,
            padding: "6px 28px",
            borderColor: "rgba(239, 239, 239, 1)",
            fontSize: "12px",
            lineHeight: "22px",
            textTransform: "unset",
            fontWeight: 400,
            color: "black",
            "&:hover": {
              borderColor: "rgba(228, 0, 70, .5)",
              backgroundColor: "white"
            }
          },
          text: {
            color: "rgba(228, 0, 70, 1)"
          }
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 100,
            fontSize: "12px",
            lineHeight: "22px",
            "&.Mui-focused": {
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(228, 0, 70, 1)"
              }
            },
            "&:hover": {
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(228, 0, 70, 1)"
              }
            }
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            "&.Mui-focused": {
              color: "rgba(228, 0, 70, 1)"
            }
          }
        }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            padding:"0",
            paddingRight: "7.5px",
            paddingLeft: "0 !important",
            "&.Mui-checked": {
              color: "rgba(228, 0, 70, 1)",
            },
            "&+.MuiTypography-root": {
              fontSize: "14px",
              lineHeight: "22px"
            },
            "& .MuiSvgIcon-root": {
              width: "16px",
            }
          }
        }
      },
      MuiRadio: {
        styleOverrides: {
          root: {
            top: "-1px",
            padding: 0,
            marginRight: "8px",
            width: "16px",
            height: "16px",
            transform: "scale(.7)",
            "&.Mui-checked": {
              color: "rgba(228, 0, 70, 1)"
            },
            "&+.MuiTypography-root": {
              fontSize: "12px"
            }
          }
        }
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            backgroundColor: "rgba(228, 0, 70, 0.1)"
          },
          bar: {
            backgroundColor: "rgba(228, 0, 70, 1)"
          }
        }
      },
      MuiInput: {
        styleOverrides: {
          root: {
            borderWidth: "1px",
            "&::after": {
              borderColor: "#E40046",
              borderWidth: "1px"
            },
            input: {
              height: "22px",
              fontSize: "12px",
              lineHeight: "22px",
              padding: "1px 0"
            }
          }
        }
      },
      MuiSnackbar: {
        styleOverrides: {
          root: {
            top: "27px !important",
            "& .MuiPaper-root": {
              backgroundColor: "rgba(252, 240, 236, 1)",
              color: "black",
              boxShadow: "unset",
              borderRadius: "16px",
              justifyContent: "center",
              minWidth: "120px !important",
              maxWidth: "360px !important",
              padding: "5px 18px !important",
              width: "max-content !important",
              boxSizing: "border-box !important",
              "& .MuiSnackbarContent-message": {
                padding: "0 !important",
                wordBreak: "all !important",
                fontSize: "12px !important",
                linHeight: "22px !important",
              }
            }
          }
        }
      },
      MuiFormControlLabel: {
        styleOverrides: {
          root: {
            marginLeft: "0 !important",
            marginRight: "20px !important"
          }
        }
      }
    },
  });
  
  