import { createTheme } from '@mui/material/styles';

export default createTheme({
  palette: {
    primary: {
      main: "rgba(228, 0, 70, 1)",
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        contained: {
          borderRadius: 12,
          padding: "8px 24px",
          backgroundColor: "rgba(228, 0, 70, 1)",
          fontSize: "13px",
          lineHeight: "22px",
          textTransform: "unset",
          fontWeight: 500,
          boxShadow: "0 2px 8px rgba(228, 0, 70, 0.2)",
          transition: "background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
          "&:hover": {
            backgroundColor: "rgba(228, 0, 70, .85)",
            boxShadow: "0 4px 12px rgba(228, 0, 70, 0.3)"
          },
        },
        outlined: {
          borderRadius: 12,
          padding: "8px 24px",
          borderColor: "rgba(220, 220, 225, 1)",
          fontSize: "13px",
          lineHeight: "22px",
          textTransform: "unset",
          fontWeight: 500,
          color: "#333",
          transition: "background-color 0.2s ease-in-out, border-color 0.2s ease-in-out",
          "&:hover": {
            borderColor: "rgba(228, 0, 70, .5)",
            backgroundColor: "rgba(228, 0, 70, 0.04)"
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
          borderRadius: 8,
          fontSize: "13px",
          lineHeight: "22px",
          "& .MuiOutlinedInput-notchedOutline": {
            transition: "border-color 0.2s ease-in-out",
          },
          "&.Mui-focused": {
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "rgba(228, 0, 70, 1)"
            }
          },
          "&:hover": {
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "rgba(228, 0, 70, 0.5)"
            }
          }
        },
      },
    },
    MuiFilledInput: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: "rgba(0, 0, 0, 0.04)",
          transition: "background-color 0.2s ease-in-out",
          "&:hover": {
            backgroundColor: "rgba(0, 0, 0, 0.06)"
          },
          "&.Mui-focused": {
            backgroundColor: "rgba(0, 0, 0, 0.04)"
          },
          "&::before, &::after": {
            display: "none"
          },
          input: {
            padding: "24px 16px 8px",
            fontSize: "13px",
            lineHeight: "22px",
            fontWeight: 500,
            color: "#1A1A24"
          }
        },
      }
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: "13px",
          transform: "translate(16px, 12px) scale(1)",
          "&.MuiInputLabel-shrink": {
            transform: "translate(16px, -8px) scale(0.85)",
            fontWeight: 600
          },
          "&.Mui-focused": {
            color: "rgba(228, 0, 70, 1)"
          }
        },
        filled: {
          transform: "translate(16px, 16px) scale(1)",
          "&.MuiInputLabel-shrink": {
            transform: "translate(16px, 5px) scale(0.75)"
          }
        }
      }
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          padding: "0",
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
            width: "18px",
          }
        }
      }
    },
    MuiRadio: {
      styleOverrides: {
        root: {
          "&.Mui-checked": {
            color: "rgba(228, 0, 70, 1)"
          },
        }
      }
    },
    MuiSwitch: {
      styleOverrides: {
        track: {
          backgroundColor: "rgba(0, 0, 0, 0.38)",
        },
        switchBase: {
          "&.Mui-checked": {
            color: "rgba(228, 0, 70, 1)",
          },
          "&.Mui-checked + .MuiSwitch-track": {
            backgroundColor: "rgba(228, 0, 70, 1)",
            opacity: 0.5,
          },
          "&.Mui-disabled": {
            color: "rgba(0, 0, 0, 0.38)",
          },
          "&.Mui-disabled + .MuiSwitch-track": {
            backgroundColor: "rgba(0, 0, 0, 0.26)",
            opacity: 1,
          },
          "&.Mui-disabled.Mui-checked": {
            color: "rgba(228, 0, 70, 0.5)",
          },
          "&.Mui-disabled.Mui-checked + .MuiSwitch-track": {
            backgroundColor: "rgba(228, 0, 70, 0.2)",
            opacity: 1,
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
            fontSize: "13px",
            lineHeight: "22px",
            padding: "1px 0"
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
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundColor: "#1A1A24",
          padding: "6px 8px 6px 20px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.12)",
          minWidth: "unset",
          flexWrap: "nowrap",
          gap: "8px",
        },
        message: {
          fontSize: "13px",
          fontWeight: 500,
          color: "#ffffff",
          padding: "6px 0",
        },
        action: {
          paddingLeft: "4px",
          marginRight: 0,
        },
      },
    },
  },
});

